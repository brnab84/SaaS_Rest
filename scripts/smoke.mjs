// Smoke post-deploy (Capa 3): verifica la app en vivo tras cada deploy.
// Uso: node scripts/smoke.mjs [URL]   (default = producción)
const BASE = (process.argv[2] || process.env.SMOKE_URL || 'https://api-production-1cc8.up.railway.app').replace(/\/+$/, '');
let failures = 0;
const get = (p, opts) => fetch(BASE + p, opts);

async function check(name, fn) {
  try { await fn(); console.log('ok   -', name); }
  catch (e) { failures += 1; console.error('FAIL -', name, '::', e.message); }
}

console.log('Smoke contra', BASE);

await check('GET /api/version', async () => {
  const r = await get('/api/version'); if (!r.ok) throw new Error(`status ${r.status}`);
  const v = await r.json(); if (!v.version) throw new Error('sin version');
  console.log('       version', v.version, '·', v.commit);
});
await check('GET /api/auth/config', async () => { const r = await get('/api/auth/config'); if (!r.ok) throw new Error(`status ${r.status}`); });
await check('GET /api/admin/overview protegido (401)', async () => { const r = await get('/api/admin/overview'); if (r.status !== 401) throw new Error(`esperaba 401, dio ${r.status}`); });
await check('GET /health', async () => { const r = await get('/health'); if (!r.ok) throw new Error(`status ${r.status}`); });
await check('storefront /r/:slug sirve HTML', async () => { const r = await get('/r/__smoke__'); if (!r.ok) throw new Error(`status ${r.status}`); });
await check('cancel con slug inexistente → 404 JSON', async () => {
  const r = await get('/api/public/__x__/orders/0123456789abcdef01234567/cancel', { method: 'POST' });
  if (r.status !== 404) throw new Error(`esperaba 404, dio ${r.status}`);
});
await check('descarga de extensión disponible', async () => { const r = await get('/downloads/ext-version.json'); if (!r.ok) throw new Error(`status ${r.status}`); });

console.log(failures ? `\n${failures} chequeo(s) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
