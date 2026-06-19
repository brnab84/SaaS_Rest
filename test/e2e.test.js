// e2e de API: levanta la app real contra una Mongo en memoria y ejecuta flujos completos.
// Atrapa regresiones de backend/contratos en cada versión (Capa 1 del QA).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ROOT_EMAIL = 'root@test.local';
let mongod; let server; let base;
const state = {};

const api = (path, { method = 'GET', token, body } = {}) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const register = (slug, email) => api('/api/auth/register', { method: 'POST', body: { businessName: slug, slug, email, password: 'test1234' } });

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = 'e2e-secret-0123456789-abcdef';
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  process.env.ROOT_EMAIL = ROOT_EMAIL;
  process.env.REGISTRATION_OPEN = 'true';
  process.env.LOG_LEVEL = 'silent';
  const { connectDB } = await import('../src/config/db.js');
  await connectDB();
  const plans = await import('../src/config/plans.js');
  await plans.loadPlans();
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try { server?.close(); } catch {}
  const mongoose = (await import('mongoose')).default;
  await mongoose.connection.close().catch(() => {});
  await mongod?.stop();
});

test('registro de comercio y /auth/me (no root)', async () => {
  const r = await register('qa-shop', 'qa@test.local');
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.ok(data.token);
  state.token = data.token;
  const me = await (await api('/api/auth/me', { token: state.token })).json();
  assert.equal(me.user.email, 'qa@test.local');
  assert.equal(me.user.isRoot, false);
});

test('crear producto y listarlo', async () => {
  const r = await api('/api/products', { method: 'POST', token: state.token, body: { name: 'Roll QA', price: 5000, category: 'Rolls' } });
  assert.equal(r.status, 201);
  state.productId = (await r.json())._id;
  const list = await (await api('/api/products', { token: state.token })).json();
  assert.equal(list.length, 1);
});

test('pedido público: 3 consecutivos sin error 500 (regresión índice externalRef)', async () => {
  const body = { customer: { name: 'Ana', phone: '+5411000' }, items: [{ productId: state.productId, qty: 2 }] };
  for (let i = 0; i < 3; i += 1) {
    const r = await api('/api/public/qa-shop/orders', { method: 'POST', body }); // eslint-disable-line no-await-in-loop
    assert.equal(r.status, 201, `pedido ${i + 1} debería ser 201`);
    if (i === 0) state.orderId = (await r.json()).id; // eslint-disable-line no-await-in-loop
  }
});

test('menú público expone el producto y settings', async () => {
  const data = await (await api('/api/public/qa-shop/menu')).json();
  assert.equal(data.products.length, 1);
  assert.equal(data.tenant.slug, 'qa-shop');
  assert.equal(typeof data.tenant.menuLayout, 'string');
});

test('seguimiento y cancelación públicos del pedido', async () => {
  const t = await api(`/api/public/qa-shop/orders/${state.orderId}`);
  assert.equal(t.status, 200);
  const c = await api(`/api/public/qa-shop/orders/${state.orderId}/cancel`, { method: 'POST' });
  assert.equal(c.status, 200);
});

test('dashboard summary responde', async () => {
  const r = await api('/api/dashboard/summary', { token: state.token });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(typeof d.revenue, 'number');
});

test('admin: una cuenta NO root recibe 403', async () => {
  const r = await api('/api/admin/overview', { token: state.token });
  assert.equal(r.status, 403);
});

test('admin: la cuenta root ve overview, planes y comercios', async () => {
  const rr = await register('qa-root', ROOT_EMAIL);
  const rootToken = (await rr.json()).token;
  state.rootToken = rootToken;
  const me = await (await api('/api/auth/me', { token: rootToken })).json();
  assert.equal(me.user.isRoot, true);
  const ov = await api('/api/admin/overview', { token: rootToken });
  assert.equal(ov.status, 200);
  const data = await ov.json();
  assert.ok(data.tenants.length >= 2);
  assert.ok(data.plans.free);
  // editar un plan
  const pe = await api('/api/admin/plans/free', { method: 'PATCH', token: rootToken, body: { limits: { products: 40 } } });
  assert.equal(pe.status, 200);
});

test('límite de productos por plan (gating)', async () => {
  // free quedó en 40 productos; bajamos a 1 y verificamos el bloqueo
  await api('/api/admin/plans/free', { method: 'PATCH', token: state.rootToken, body: { limits: { products: 1 } } });
  const r = await api('/api/products', { method: 'POST', token: state.token, body: { name: 'Segundo', price: 100 } });
  assert.equal(r.status, 400); // ya tiene 1 producto, supera el límite
});

test('eventos: crear, agregar ítems y calcular margen', async () => {
  const c = await api('/api/events', { method: 'POST', token: state.token, body: { name: 'Paola y Darío', pax: 25, revenue: 55000, description: 'Día del Padre' } });
  assert.equal(c.status, 201);
  const eventId = (await c.json())._id;
  const add = await api(`/api/events/${eventId}/items`, {
    method: 'POST', token: state.token,
    body: { items: [{ name: 'Panko', vendor: 'jumbo', amount: 983, note: '0,8kg' }, { name: 'Langostino', vendor: 'casa china', amount: 3000 }] },
  });
  assert.equal(add.status, 201);
  assert.equal((await add.json()).added, 2);
  const det = await (await api(`/api/events/${eventId}`, { token: state.token })).json();
  assert.equal(det.items.length, 2);
  assert.equal(det.spent, 3983);
  assert.equal(det.margin, 55000 - 3983);
  // los gastos del evento NO aparecen en "Generales"
  const generales = await (await api('/api/expenses', { token: state.token })).json();
  assert.ok(generales.every((g) => !g.eventId));
});

test('chat comercio ↔ root', async () => {
  const s = await api('/api/messages', { method: 'POST', token: state.token, body: { text: 'Hola soporte' } });
  assert.equal(s.status, 201);
  const thread = await (await api('/api/messages', { token: state.token })).json();
  assert.equal(thread.length, 1);
  const tenantId = (await (await api('/api/auth/me', { token: state.token })).json()).tenant.id || thread[0].tenantId;
  const adminThread = await api(`/api/admin/messages/${thread[0].tenantId}`, { token: state.rootToken });
  assert.equal(adminThread.status, 200);
});
