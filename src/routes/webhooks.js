import { Router } from 'express';
import { env } from '../config/env.js';
import { Tenant } from '../models/Tenant.js';
import { resolveTenantSecret } from '../utils/secrets.js';
import { verifyMpSignature, verifyMetaSignature } from '../utils/signatures.js';
import { enqueueJob } from '../jobs/queue.js';
import { logger } from '../utils/logger.js';

const router = Router();

// --- Mercado Pago: confirmación de pago (por tenant en la URL) ---
router.post('/mp/:tenantId', async (req, res) => {
  const tenant = await Tenant.findById(req.params.tenantId).catch(() => null);
  if (!tenant) return res.sendStatus(404);

  const mp = tenant.settings?.mercadopago;
  const secret = resolveTenantSecret(mp?.webhookSecretEnc, mp?.webhookSecretRef) || env.mp.webhookSecret;
  if (secret) {
    const ok = verifyMpSignature({
      signatureHeader: req.headers['x-signature'],
      requestId: req.headers['x-request-id'],
      dataId: req.query['data.id'] ?? req.body?.data?.id,
      secret,
    });
    if (!ok) return res.sendStatus(401);
  }

  // Encolar (insert rápido, durable) y recién después confirmar: el worker procesa async.
  try {
    const { type, data } = req.body;
    if (type === 'payment' && data?.id) {
      await enqueueJob('mp_payment', { tenantId: tenant._id.toString(), paymentId: String(data.id) });
    }
  } catch (e) { logger.error({ e }, 'Webhook MP: fallo al encolar'); }
  res.sendStatus(200);
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

router.post('/wa', metaSignatureGuard, async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    if (value?.messages?.[0]) { // ignorar statuses u otros eventos sin mensaje
      await enqueueJob('wa_message', { value });
    }
  } catch (e) { logger.error({ e }, 'Webhook WA: fallo al encolar'); }
  res.sendStatus(200);
});

// Middleware: exige firma válida de Meta cuando hay app secret configurado (en dev sin secret pasa).
function metaSignatureGuard(req, res, next) {
  const sig = req.headers['x-hub-signature-256'];
  if (!env.wa.appSecret || !sig || !req.rawBody) return next();
  if (!verifyMetaSignature({ signatureHeader: sig, rawBody: req.rawBody, appSecret: env.wa.appSecret })) {
    return res.sendStatus(401);
  }
  next();
}

export default router;
