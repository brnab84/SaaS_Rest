// Cliente de la API. El token JWT se guarda en localStorage y se manda como Bearer.
const TOKEN_KEY = 'restaurapp.token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}
export function isAuthed() { return !!getToken(); }
export function logout() { setToken(null); }

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) { logout(); throw new ApiError('Sesión expirada', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.message || 'Error de servidor', res.status);
  return data;
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function login(email, password) {
  const data = await request('/auth/login', { method: 'POST', body: { email, password } });
  setToken(data.token);
  return data;
}

export async function register(payload) {
  const data = await request('/auth/register', { method: 'POST', body: payload });
  setToken(data.token);
  return data;
}

// Config pública (¿registro abierto?). No rompe si falla: asume cerrado.
export async function getAuthConfig() {
  try { return await request('/auth/config'); } catch { return { registrationOpen: false }; }
}

export const api = {
  summary: (q = '') => request(`/dashboard/summary${q}`),
  sales: (q = '') => request(`/dashboard/sales${q}`),
  expenses: (q = '') => request(`/dashboard/expenses${q}`),
  products: (q = '') => request(`/dashboard/products${q}`),
  forecast: (days = 7) => request(`/dashboard/forecast?days=${days}`),
};

export const me = () => request('/auth/me');

export const tenantApi = {
  get: () => request('/tenant'),
  update: (b) => request('/tenant', { method: 'PATCH', body: b }),
  usage: () => request('/tenant/usage'),
  setPlan: (plan) => request('/tenant/plan', { method: 'PATCH', body: { plan } }),
};

// URL del stream SSE de pedidos (el token va por query porque EventSource no manda headers).
export function ordersStreamUrl() {
  const t = getToken();
  return `/api/orders/stream${t ? `?token=${encodeURIComponent(t)}` : ''}`;
}

export const productsApi = {
  list: () => request('/products'),
  create: (b) => request('/products', { method: 'POST', body: b }),
  update: (id, b) => request(`/products/${id}`, { method: 'PATCH', body: b }),
  remove: (id) => request(`/products/${id}`, { method: 'DELETE' }),
};

export const ordersApi = {
  list: (status) => request(`/orders${status ? `?status=${status}` : ''}`),
  setStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status } }),
  pay: (id) => request(`/orders/${id}/pay`, { method: 'POST' }),
};

export const expensesApi = {
  list: () => request('/expenses'),
  create: (b) => request('/expenses', { method: 'POST', body: b }),
  update: (id, b) => request(`/expenses/${id}`, { method: 'PATCH', body: b }),
  remove: (id) => request(`/expenses/${id}`, { method: 'DELETE' }),
};

export const campaignsApi = {
  list: () => request('/campaigns'),
  create: (b) => request('/campaigns', { method: 'POST', body: b }),
  remove: (id) => request(`/campaigns/${id}`, { method: 'DELETE' }),
  suggest: () => request('/campaigns/suggest', { method: 'POST' }),
};

// Importar el catálogo de WhatsApp Business (requiere WhatsApp conectado + ID de catálogo).
export function importProductsFromWhatsApp(catalogId) {
  return request('/products/import/whatsapp', { method: 'POST', body: { catalogId } });
}

// Subir una imagen (logo, portada, foto de producto). Devuelve { url } absoluta.
export async function uploadImage(file) {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/files', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  if (res.status === 401) { logout(); throw new ApiError('Sesión expirada', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.message || 'No se pudo subir la imagen', res.status);
  return data;
}

// Importar menú: archivo (PDF/imagen) o texto pegado → la IA crea los productos.
export async function importProducts({ file, text }) {
  const token = getToken();
  let opts;
  if (file) {
    const fd = new FormData();
    fd.append('file', file);
    opts = { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd };
  } else {
    opts = { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ text }) };
  }
  const res = await fetch('/api/products/import', opts);
  if (res.status === 401) { logout(); throw new ApiError('Sesión expirada', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.message || 'No se pudo importar', res.status);
  return data;
}

// Crear artículo desde una foto: la IA detecta nombre, descripción y categoría sugerida.
export async function productFromPhoto(file) {
  const token = getToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/products/from-photo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  if (res.status === 401) { logout(); throw new ApiError('Sesión expirada', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.message || 'No se pudo analizar la foto', res.status);
  return data;
}

// Subida multipart de la foto de factura para OCR.
export async function uploadExpenseOcr(file) {
  const fd = new FormData();
  fd.append('photo', file);
  const token = getToken();
  const res = await fetch('/api/expenses/ocr', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (res.status === 401) { logout(); throw new ApiError('Sesión expirada', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.message || 'No se pudo procesar la foto', res.status);
  return data;
}
