import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { encryptSecret } from '../utils/crypto.js';
import { notFound, forbidden } from '../utils/errors.js';
import { allPlans, getPlan } from '../config/plans.js';
import { createSubscription } from '../services/mercadopago.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

// Vista pública del tenant: nunca expone secretos, solo flags de conexión + IDs no sensibles.
function publicView(doc) {
  const t = doc.toJSON();
  const s = t.settings || {};
  return {
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    settings: { currency: s.currency, storeOpen: s.storeOpen !== false, allowCancel: s.allowCancel !== false, whitelabel: s.whitelabel !== false, categories: s.categories || [], orderMessages: s.orderMessages || {} },
    whitelabelAllowed: getPlan(t.plan).features?.whitelabel === true, // ¿el plan permite marca propia?
    branding: t.branding || {},
    integrations: {
      whatsapp: { phoneId: s.whatsapp?.phoneId, wabaId: s.whatsapp?.wabaId, connected: !!s.whatsapp?.tokenEnc },
      instagram: { igUserId: s.instagram?.igUserId, connected: !!s.instagram?.tokenEnc },
      mercadopago: { publicKey: s.mercadopago?.publicKey, connected: !!s.mercadopago?.accessTokenEnc, webhookConfigured: !!s.mercadopago?.webhookSecretEnc },
    },
  };
}

router.get('/', async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.auth.tenantId);
    if (!tenant) return next(notFound('Comercio no encontrado'));
    res.json(publicView(tenant));
  } catch (e) { next(e); }
});

// Uso del plan: cuántos productos y pedidos llevás vs los límites de tu plan.
router.get('/usage', async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.auth.tenantId).select('plan');
    const plan = getPlan(tenant?.plan);
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const [products, ordersThisMonth] = await Promise.all([
      Product.countDocuments({ tenantId: req.auth.tenantId }),
      Order.countDocuments({ tenantId: req.auth.tenantId, createdAt: { $gte: startOfMonth } }),
    ]);
    res.json({
      plan: tenant?.plan || 'free',
      plans: allPlans(), // catálogo de planes para mostrar comparación y precios
      limits: plan.limits, // Infinity se serializa como null = sin límite
      usage: { products, ordersThisMonth },
    });
  } catch (e) { next(e); }
});

// Cambiar de plan. Hoy es alta manual (sin cobro); cuando haya credenciales de pago,
// este endpoint pasará por el checkout de Mercado Pago/Stripe.
const planSchema = z.object({ plan: z.enum(['free', 'pro', 'business']) });
router.patch('/plan', requireRole('owner'), validate(planSchema), async (req, res, next) => {
  try {
    const tenant = await Tenant.findByIdAndUpdate(req.auth.tenantId, { $set: { plan: req.body.plan } }, { new: true });
    if (!tenant) return next(notFound('Comercio no encontrado'));
    res.json({ plan: tenant.plan });
  } catch (e) { next(e); }
});

// Iniciar el cobro de un plan pago. Si hay credenciales MP de la plataforma, crea una
// suscripción y devuelve { mode:'checkout', url } para redirigir; si no, { mode:'manual' }.
const checkoutSchema = z.object({ plan: z.enum(['pro', 'business']) });
router.post('/billing/checkout', requireRole('owner'), validate(checkoutSchema), async (req, res, next) => {
  try {
    const planId = req.body.plan;
    const plan = getPlan(planId);
    if (!env.mp.accessToken) return res.json({ mode: 'manual' }); // sin credenciales de cobro
    const user = await User.findById(req.auth.userId).select('email');
    const { init_point } = await createSubscription({
      accessToken: env.mp.accessToken,
      planLabel: plan.label,
      amount: plan.priceMonthly,
      payerEmail: user?.email,
      externalReference: `${req.auth.tenantId}:${planId}`,
      backUrl: `${env.appBaseUrl}/app/`,
      notificationUrl: `${env.appBaseUrl}/webhooks/mp-billing`,
    });
    res.json({ mode: 'checkout', url: init_point });
  } catch (e) { next(e); }
});

const str = z.string().optional();
const patchSchema = z.object({
  name: z.string().min(2).optional(),
  settings: z.object({
    currency: z.string().min(2).max(8).optional(),
    storeOpen: z.boolean().optional(),
    allowCancel: z.boolean().optional(),
    whitelabel: z.boolean().optional(),
    categories: z.array(z.string().min(1).max(40)).max(40).optional(),
    orderMessages: z.object({
      confirmed: z.string().max(300).optional(),
      preparing: z.string().max(300).optional(),
      ready: z.string().max(300).optional(),
      on_way: z.string().max(300).optional(),
      delivered: z.string().max(300).optional(),
    }).optional(),
  }).optional(),
  branding: z.object({
    description: z.string().max(300).optional(),
    logo: z.string().url().optional().or(z.literal('')),
    cover: z.string().url().optional().or(z.literal('')),
    colors: z.object({ accent: z.string().max(32).optional() }).optional(),
    theme: z.string().max(24).optional(),
    cuisine: z.string().max(40).optional(),
    phone: z.string().max(40).optional(),
  }).optional(),
  integrations: z.object({
    whatsapp: z.object({ phoneId: str, wabaId: str, token: str }).optional(),
    instagram: z.object({ igUserId: str, token: str }).optional(),
    mercadopago: z.object({ publicKey: str, accessToken: str, webhookSecret: str }).optional(),
  }).optional(),
});

router.patch('/', requireRole('owner', 'admin'), validate(patchSchema), async (req, res, next) => {
  try {
    const b = req.body;
    // Gating: el plan del comercio puede no incluir integraciones.
    if (b.integrations) {
      const tdoc = await Tenant.findById(req.auth.tenantId).select('plan');
      if (getPlan(tdoc?.plan).features?.integrations === false) {
        return next(forbidden('Tu plan no incluye integraciones. Mejorá tu plan en Ajustes → Plan y uso.'));
      }
    }
    const $set = {}; const $unset = {};
    const setSecret = (path, val) => { if (val) $set[path] = encryptSecret(val); else $unset[path] = 1; };

    if (b.name !== undefined) $set.name = b.name;
    if (b.settings?.currency !== undefined) $set['settings.currency'] = b.settings.currency;
    if (b.settings?.storeOpen !== undefined) $set['settings.storeOpen'] = b.settings.storeOpen;
    if (b.settings?.allowCancel !== undefined) $set['settings.allowCancel'] = b.settings.allowCancel;
    if (b.settings?.whitelabel !== undefined) $set['settings.whitelabel'] = b.settings.whitelabel;
    if (b.settings?.categories !== undefined) $set['settings.categories'] = b.settings.categories;
    if (b.settings?.orderMessages) {
      for (const [k, v] of Object.entries(b.settings.orderMessages)) {
        if (v !== undefined) $set[`settings.orderMessages.${k}`] = v;
      }
    }

    const br = b.branding || {};
    if (br.description !== undefined) $set['branding.description'] = br.description;
    if (br.logo !== undefined) $set['branding.logo'] = br.logo;
    if (br.cover !== undefined) $set['branding.cover'] = br.cover;
    if (br.colors?.accent !== undefined) $set['branding.colors.accent'] = br.colors.accent;
    if (br.theme !== undefined) $set['branding.theme'] = br.theme;
    if (br.cuisine !== undefined) $set['branding.cuisine'] = br.cuisine;
    if (br.phone !== undefined) $set['branding.phone'] = br.phone;

    const ig = b.integrations || {};
    if (ig.whatsapp) {
      const w = ig.whatsapp;
      if (w.phoneId !== undefined) $set['settings.whatsapp.phoneId'] = w.phoneId;
      if (w.wabaId !== undefined) $set['settings.whatsapp.wabaId'] = w.wabaId;
      if (w.token !== undefined) setSecret('settings.whatsapp.tokenEnc', w.token);
    }
    if (ig.instagram) {
      const i = ig.instagram;
      if (i.igUserId !== undefined) $set['settings.instagram.igUserId'] = i.igUserId;
      if (i.token !== undefined) setSecret('settings.instagram.tokenEnc', i.token);
    }
    if (ig.mercadopago) {
      const m = ig.mercadopago;
      if (m.publicKey !== undefined) $set['settings.mercadopago.publicKey'] = m.publicKey;
      if (m.accessToken !== undefined) setSecret('settings.mercadopago.accessTokenEnc', m.accessToken);
      if (m.webhookSecret !== undefined) setSecret('settings.mercadopago.webhookSecretEnc', m.webhookSecret);
    }

    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;

    const tenant = await Tenant.findByIdAndUpdate(req.auth.tenantId, update, { new: true, runValidators: true });
    if (!tenant) return next(notFound('Comercio no encontrado'));
    res.json(publicView(tenant));
  } catch (e) { next(e); }
});

export default router;
