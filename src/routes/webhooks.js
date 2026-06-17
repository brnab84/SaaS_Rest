import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { Order } from '../models/Order.js';
import { Tenant } from '../models/Tenant.js';
import { getPayment } from '../services/mercadopago.js';
import { logger } from '../utils/logger.js';

const router = Router();

// --- Mercado Pago: confirmación de pago ---
router.post('/mp', async (req, res) => {
  res.sendStatus(200); // responder rápido SIEMPRE para evitar reintentos
  try {
    const { type, data } = req.body;
    if (type !== 'payment') return;
    // TODO Claude Code: validar firma x-signature según tenant
    const order = await Order.findById(undefined); // placeholder, ver abajo
    const accessToken = env.mp.accessToken;
    const pay = await getPayment({ accessToken, paymentId: data.id });
    const target = await Order.findById(pay.external_reference);
    if (!target) return;

    // Idempotencia: ignorar si ya procesamos este paymentId
    if (target.payment.mpPaymentId === String(pay.id) && target.payment.status === 'paid') return;

    if (pay.status === 'approved') {
      target.payment.mpPaymentId = String(pay.id);
      target.payment.amountPaid += pay.transaction_amount;
      target.payment.status = target.payment.amountPaid >= target.total ? 'paid' : 'partial';
      await target.save();
    }
  } catch (e) { logger.error({ e }, 'Webhook MP error'); }
});

// --- WhatsApp: verificación (GET) + mensajes entrantes (POST) ---
router.get('/wa', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  if (mode === 'subscribe' && token === env.wa.verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

router.post('/wa', verifyMetaSignature, async (req, res) => {
  res.sendStatus(200);
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;
    // TODO Claude Code: resolver tenant por value.metadata.phone_number_id,
    // parsear el mensaje y crear/actualizar Order (channel: 'whatsapp')
    logger.info({ from: msg.from }, 'Mensaje WA entrante');
  } catch (e) { logger.error({ e }, 'Webhook WA error'); }
});

// Valida firma HMAC de Meta
function verifyMetaSignature(req, res, next) {
  const sig = req.headers['x-hub-signature-256'];
  if (!env.wa.appSecret || !sig || !req.rawBody) return next(); // dev sin secret
  const expected = 'sha256=' + crypto.createHmac('sha256', env.wa.appSecret)
    .update(req.rawBody).digest('hex');
  if (sig !== expected) return res.sendStatus(401);
  next();
}

export default router;
