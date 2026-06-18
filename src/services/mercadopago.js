import { env } from '../config/env.js';

const MP_API = 'https://api.mercadopago.com';

// Crea una preference de Checkout Pro y devuelve { id, init_point }
// amount: total o parcial según lo que decida el comercio
export async function createPaymentLink({ accessToken, order, amount }) {
  const res = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{
        title: `Pedido ${order.code}`,
        quantity: 1,
        unit_price: amount,
        currency_id: 'ARS',
      }],
      external_reference: order._id.toString(), // reconciliación
      // tenant en la URL: el webhook resuelve el secret de firma del comercio correcto
      notification_url: `${env.appBaseUrl}/webhooks/mp/${order.tenantId}`,
      back_urls: {
        success: `${env.appBaseUrl}/pago/ok`,
        failure: `${env.appBaseUrl}/pago/error`,
        pending: `${env.appBaseUrl}/pago/pendiente`,
      },
      auto_return: 'approved',
    }),
  });
  if (!res.ok) throw new Error(`MP preference falló: ${res.status}`);
  const data = await res.json();
  return { id: data.id, init_point: data.init_point };
}

// Consulta un pago por ID (usado en el webhook)
export async function getPayment({ accessToken, paymentId }) {
  const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`MP getPayment falló: ${res.status}`);
  return res.json();
}

// --- Suscripción de plan (la plataforma cobra al comercio) -----------------
// Crea una suscripción (preapproval) recurrente mensual y devuelve { id, init_point }.
// Usa la cuenta MP de la plataforma (RestaurApp), no la del comercio.
export async function createSubscription({ accessToken, planLabel, amount, payerEmail, externalReference, backUrl, notificationUrl }) {
  const res = await fetch(`${MP_API}/preapproval`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: `RestaurApp — Plan ${planLabel}`,
      external_reference: externalReference, // "tenantId:plan" para reconciliar en el webhook
      payer_email: payerEmail,
      back_url: backUrl,
      status: 'pending',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: amount, currency_id: 'ARS' },
      notification_url: notificationUrl,
    }),
  });
  if (!res.ok) throw new Error(`MP preapproval falló: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { id: data.id, init_point: data.init_point };
}

// Consulta una suscripción (preapproval) por ID (usado en el webhook de billing)
export async function getSubscription({ accessToken, preapprovalId }) {
  const res = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`MP getSubscription falló: ${res.status}`);
  return res.json();
}
