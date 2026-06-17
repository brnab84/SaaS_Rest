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

export const api = {
  summary: (q = '') => request(`/dashboard/summary${q}`),
  sales: (q = '') => request(`/dashboard/sales${q}`),
  expenses: (q = '') => request(`/dashboard/expenses${q}`),
  products: (q = '') => request(`/dashboard/products${q}`),
  forecast: (days = 7) => request(`/dashboard/forecast?days=${days}`),
};
