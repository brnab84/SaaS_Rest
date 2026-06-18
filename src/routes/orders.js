import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Order } from '../models/Order.js';
import { Tenant } from '../models/Tenant.js';
import { createPaymentLink } from '../services/mercadopago.js';
import { sendText } from '../services/whatsapp.js';
import { notFound } from '../utils/errors.js';
import { resolveTenantSecret } from '../utils/secrets.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

// Listar pedidos activos del tenant (panel en vivo)
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = { tenantId: req.auth.tenantId };
    if (status) filter.status = status;
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json(orders);
  } catch (e) { next(e); }
});

const statusSchema = z.object({
  status: z.enum(['new', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered', 'cancelled']),
});

// Cambiar estado + notificar al cliente por WhatsApp
router.patch('/:id/status', validate(statusSchema), async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!order) return next(notFound('Pedido no encontrado'));
    order.status = req.body.status;
    order.timeline.push({ status: req.body.status, by: req.auth.userId });
    await order.save();

    // Notificación opcional al cliente (best-effort, no bloquea la respuesta)
    notifyCustomer(req.auth.tenantId, order).catch(() => {});
    res.json(order);
  } catch (e) { next(e); }
});

// Generar link de pago Mercado Pago (total o parcial)
const payLinkSchema = z.object({ amount: z.number().positive().optional() });

router.post('/:id/payment-link', validate(payLinkSchema), async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!order) return next(notFound('Pedido no encontrado'));
    const tenant = await Tenant.findById(req.auth.tenantId);
    const mp = tenant.settings?.mercadopago;
    const accessToken = resolveTenantSecret(mp?.accessTokenEnc, mp?.tokenRef) || env.mp.accessToken;
    const amount = req.body.amount ?? order.total;

    const { id, init_point } = await createPaymentLink({ accessToken, order, amount });
    order.payment.mpPreferenceId = id;
    order.payment.linkUrl = init_point;
    await order.save();
    res.json({ linkUrl: init_point });
  } catch (e) { next(e); }
});

const STATUS_MSG = {
  preparing: 'Tu pedido está en marcha 👨‍🍳',
  ready: '¡Tu pedido está listo! ✅',
  on_way: 'Tu pedido va en camino 🛵',
};

async function notifyCustomer(tenantId, order) {
  const msg = STATUS_MSG[order.status];
  if (!msg || !order.customer?.phone) return;
  const tenant = await Tenant.findById(tenantId);
  const wa = tenant.settings.whatsapp;
  if (!wa?.phoneId) return;
  await sendText({
    phoneId: wa.phoneId, token: resolveTenantSecret(wa.tokenEnc, wa.tokenRef),
    to: order.customer.phone, body: `${msg} (Pedido ${order.code})`,
  });
}

export default router;
