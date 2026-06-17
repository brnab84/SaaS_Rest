const GRAPH = 'https://graph.facebook.com/v21.0';

// Envía texto libre (solo dentro de la ventana de 24h de Meta)
export async function sendText({ phoneId, token, to, body }) {
  return post(phoneId, token, {
    messaging_product: 'whatsapp', to, type: 'text', text: { body },
  });
}

// Envía ubicación (compartir destino / local)
export async function sendLocation({ phoneId, token, to, lat, lng, name, address }) {
  return post(phoneId, token, {
    messaging_product: 'whatsapp', to, type: 'location',
    location: { latitude: lat, longitude: lng, name, address },
  });
}

// Envía plantilla pre-aprobada (fuera de la ventana de 24h)
export async function sendTemplate({ phoneId, token, to, template, lang = 'es_AR', components = [] }) {
  return post(phoneId, token, {
    messaging_product: 'whatsapp', to, type: 'template',
    template: { name: template, language: { code: lang }, components },
  });
}

async function post(phoneId, token, payload) {
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`WhatsApp send falló: ${res.status} ${await res.text()}`);
  return res.json();
}
