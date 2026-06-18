import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Tenant } from '../models/Tenant.js';
import { encryptSecret } from '../utils/crypto.js';
import { notFound } from '../utils/errors.js';

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
    settings: { currency: s.currency, storeOpen: s.storeOpen !== false },
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

const str = z.string().optional();
const patchSchema = z.object({
  name: z.string().min(2).optional(),
  settings: z.object({ currency: z.string().min(2).max(8).optional(), storeOpen: z.boolean().optional() }).optional(),
  branding: z.object({
    description: z.string().max(300).optional(),
    logo: z.string().url().optional().or(z.literal('')),
    cover: z.string().url().optional().or(z.literal('')),
    colors: z.object({ accent: z.string().max(32).optional() }).optional(),
    theme: z.string().max(24).optional(),
    cuisine: z.string().max(40).optional(),
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
    const $set = {}; const $unset = {};
    const setSecret = (path, val) => { if (val) $set[path] = encryptSecret(val); else $unset[path] = 1; };

    if (b.name !== undefined) $set.name = b.name;
    if (b.settings?.currency !== undefined) $set['settings.currency'] = b.settings.currency;
    if (b.settings?.storeOpen !== undefined) $set['settings.storeOpen'] = b.settings.storeOpen;

    const br = b.branding || {};
    if (br.description !== undefined) $set['branding.description'] = br.description;
    if (br.logo !== undefined) $set['branding.logo'] = br.logo;
    if (br.cover !== undefined) $set['branding.cover'] = br.cover;
    if (br.colors?.accent !== undefined) $set['branding.colors.accent'] = br.colors.accent;
    if (br.theme !== undefined) $set['branding.theme'] = br.theme;
    if (br.cuisine !== undefined) $set['branding.cuisine'] = br.cuisine;

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
