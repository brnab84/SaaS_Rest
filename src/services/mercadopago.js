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
      notification_url: `${env.appBaseUrl}/webhooks/mp`,
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
