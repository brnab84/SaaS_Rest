import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Order } from '../models/Order.js';
import { Tenant } from '../models/Tenant.js';
import { createPaymentLink } from '../services/mercadopago.js';
import { sendText } from '../services/whatsapp.js';
import { notFound, unauthorized } from '../utils/errors.js';
import { resolveTenantSecret } from '../utils/secrets.js';
import { orderEvents, emitOrderChange } from '../services/orderEvents.js';
import { env } from '../config/env.js';

const router = Router();

// SSE: stream de cambios de pedidos en tiempo real (panel en vivo, push instantáneo).
// EventSource no permite headers, así que el token JWT viaja por query (?token=).
router.get('/stream', (req, res, next) => {
  let tenantId;
  try { tenantId = jwt.verify(req.query.token, env.jwtSecret).tenantId; }
  catch { return next(unauthorized('Token inválido o expirado')); }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // evita buffering de proxies (Railway/nginx)
  });
  res.write('retry: 5000\n\n');

  const ping = setInterval(() => res.write(': keep-alive\n\n'), 25000); // mantiene viva la conexión
  const onChange = (tid) => { if (tid === String(tenantId)) res.write('event: change\ndata: {}\n\n'); };
  orderEvents.on('change', onChange);
  req.on('close', () => { clearInterval(ping); orderEvents.off('change', onChange); });
});

router.use(requireAuth);

// Horas que un pedido entregado/cancelado sigue visible en la lista activa antes de archivarse.
const ARCHIVE_HOURS = 12;

// Listar pedidos del tenant. Por defecto: activos (no entregados/cancelados, más los
// finalizados en las últimas 12h). ?archived=1 = historial archivado. ?status=X = filtro exacto.
router.get('/', async (req, res, next) => {
  try {
    const { status, archived } = req.query;
    const tenantId = req.auth.tenantId;
    const cutoff = new Date(Date.now() - ARCHIVE_HOURS * 3600 * 1000);
    let filter;
    if (status) {
      filter = { tenantId, status };
    } else if (archived === '1') {
      filter = { tenantId, status: { $in: ['delivered', 'cancelled'] }, updatedAt: { $lt: cutoff } };
    } else {
      filter = { tenantId, $or: [{ status: { $nin: ['delivered', 'cancelled'] } }, { updatedAt: { $gte: cutoff } }] };
    }
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

    emitOrderChange(req.auth.tenantId); // panel en vivo (SSE)
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

// Marcar pedido como cobrado (efectivo/transferencia) → cuenta como venta en el dashboard.
router.post('/:id/pay', async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.auth.tenantId });
    if (!order) return next(notFound('Pedido no encontrado'));
    order.payment.status = 'paid';
    order.payment.amountPaid = order.total;
    await order.save();
    emitOrderChange(req.auth.tenantId); // panel en vivo (SSE)
    res.json(order);
  } catch (e) { next(e); }
});

// Mensajes por defecto por estado (el comercio puede sobreescribirlos en Ajustes).
export const DEFAULT_STATUS_MSG = {
  confirmed: 'Confirmamos tu pedido ✅',
  preparing: 'Tu pedido está en marcha 👨‍🍳',
  ready: '¡Tu pedido está listo! ✅',
  on_way: 'Tu pedido va en camino 🛵',
  delivered: '¡Gracias por tu compra! 🙌',
};

async function notifyCustomer(tenantId, order) {
  if (!order.customer?.phone) return;
  const tenant = await Tenant.findById(tenantId);
  const custom = tenant.settings?.orderMessages || {};
  const msg = (custom[order.status] && String(custom[order.status]).trim()) || DEFAULT_STATUS_MSG[order.status];
  if (!msg) return;
  const wa = tenant.settings.whatsapp;
  if (!wa?.phoneId) return;
  await sendText({
    phoneId: wa.phoneId, token: resolveTenantSecret(wa.tokenEnc, wa.tokenRef),
    to: order.customer.phone, body: `${msg} (Pedido ${order.code})`,
  });
}

export default router;
