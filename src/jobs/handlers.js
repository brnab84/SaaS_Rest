// Lógica de procesamiento de eventos de webhooks, desacoplada del request HTTP.
// La usan tanto el webhook (best-effort inline) como el worker async (cola con reintentos).
import { Order } from '../models/Order.js';
import { Tenant } from '../models/Tenant.js';
import { getPayment } from '../services/mercadopago.js';
import { resolveTenantSecret } from '../utils/secrets.js';
import { generateOrderCode } from '../utils/orderCode.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// --- Mercado Pago: confirmar pago e impactar en la Order (idempotente) ---
export async function processMpPayment({ tenantId, paymentId }) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return;
  const mp = tenant.settings?.mercadopago;
  const accessToken = resolveTenantSecret(mp?.accessTokenEnc, mp?.tokenRef) || env.mp.accessToken;
  if (!accessToken) { logger.warn({ tenantId }, 'MP sin access token'); return; }

  const pay = await getPayment({ accessToken, paymentId });
  // La Order se referencia por external_reference; verificamos que sea del mismo tenant.
  const order = await Order.findOne({ _id: pay.external_reference, tenantId });
  if (!order) return;

  // Idempotencia: si ya impactamos este paymentId y está pago, no hacemos nada.
  if (order.payment.mpPaymentId === String(pay.id) && order.payment.status === 'paid') return;

  if (pay.status === 'approved') {
    order.payment.mpPaymentId = String(pay.id);
    order.payment.amountPaid = pay.transaction_amount; // monto confirmado por MP
    order.payment.status = order.payment.amountPaid >= order.total ? 'paid' : 'partial';
    await order.save();
  }
}

// --- WhatsApp: mensaje entrante → Order (channel whatsapp), idempotente por messageId ---
export async function processWaMessage({ value }) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  const msg = value?.messages?.[0];
  if (!phoneNumberId || !msg) return;

  const tenant = await Tenant.findOne({ 'settings.whatsapp.phoneId': phoneNumberId });
  if (!tenant) { logger.warn({ phoneNumberId }, 'WA sin tenant para phone_number_id'); return; }

  // Idempotencia: Meta puede reintentar el mismo mensaje.
  const exists = await Order.findOne({
    tenantId: tenant._id, 'externalRef.source': 'whatsapp', 'externalRef.externalId': msg.id,
  });
  if (exists) return;

  const text = msg.text?.body || `[${msg.type}]`;
  const customerName = value.contacts?.[0]?.profile?.name;

  await Order.create({
    tenantId: tenant._id,
    code: generateOrderCode(),
    channel: 'whatsapp',
    customer: { name: customerName, phone: msg.from },
    // El texto entra como ítem para que el panel lo muestre; el cajero arma el pedido real.
    items: [{ name: text, qty: 1, unitPrice: 0, subtotal: 0 }],
    total: 0,
    status: 'new',
    externalRef: { source: 'whatsapp', externalId: msg.id },
    timeline: [{ status: 'new', by: 'whatsapp' }],
  });
}
