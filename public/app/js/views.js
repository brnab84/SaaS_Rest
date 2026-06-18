import { api, me, tenantApi, productsApi, ordersApi, expensesApi, campaignsApi, uploadExpenseOcr } from './api.js';
import { money, num, esc, formModal, confirmDialog, toast, onInterval } from './ui.js';

const CAT_ES = { supplies: 'Insumos', rent: 'Alquiler', salary: 'Sueldos', utilities: 'Servicios', other: 'Otros' };
const EXP_CATS = Object.entries(CAT_ES).map(([value, label]) => ({ value, label }));
const EXP_VALID = new Set(Object.keys(CAT_ES));

const ORDER_FLOW = ['new', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered'];
const ORDER_LABEL = { new: 'Nuevo', confirmed: 'Confirmado', preparing: 'En cocina', ready: 'Listo', on_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado' };
const nextStatus = (s) => { const i = ORDER_FLOW.indexOf(s); return i >= 0 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null; };

const loading = (host) => { host.innerHTML = '<div class="spinner">Cargando…</div>'; };

/* ===================== RESUMEN ===================== */
export async function renderResumen(host) {
  host.innerHTML = `
    <div class="view-head"><h1>Resumen</h1><span class="muted">últimos 30 días</span></div>
    <div id="kpis" class="kpi-grid"><div class="spinner">Cargando…</div></div>
    <div class="panel-grid">
      <div class="panel"><h2>Ventas por día</h2><div id="r-sales">—</div></div>
      <div class="panel"><h2>Gastos por categoría</h2><div id="r-exp">—</div></div>
    </div>
    <div class="panel"><h2>Productos más vendidos</h2><div id="r-prod">—</div></div>
    <div class="panel">
      <div class="panel-head"><h2>Pronóstico de ventas (IA)</h2><button class="btn btn-accent" id="fc-btn">Proyectar 7 días</button></div>
      <div id="r-fc" style="margin-top:12px"></div>
    </div>`;

  const [s, sales, exp, prod] = await Promise.allSettled([api.summary(), api.sales(), api.expenses(), api.products()]);
  const kpis = host.querySelector('#kpis');
  if (s.status === 'fulfilled') {
    const d = s.value; const profit = d.grossProfit ?? (d.revenue - d.expenses);
    const c = (l, v, e = '') => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div>${e}</div>`;
    kpis.innerHTML = c('Ventas', money.format(d.revenue || 0)) + c('Pedidos', num.format(d.orders || 0))
      + c('Ticket promedio', money.format(d.avgTicket || 0)) + c('Gastos', money.format(d.expenses || 0))
      + c('Ganancia bruta', money.format(profit || 0), `<div class="delta ${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '▲' : '▼'} margen</div>`);
  } else kpis.innerHTML = '<div class="empty">No se pudo cargar el resumen.</div>';

  host.querySelector('#r-sales').innerHTML = barsChart(sales.status === 'fulfilled' ? sales.value : [], 'Todavía no hay ventas pagadas.');
  host.querySelector('#r-exp').innerHTML = listChart(exp.status === 'fulfilled' ? exp.value : [], (e) => CAT_ES[e.category] || e.category || 'Otros', (e) => e.total, 'Sin gastos en el período.');
  host.querySelector('#r-prod').innerHTML = listChart(prod.status === 'fulfilled' ? prod.value : [], (p) => p.name || 'Producto', (p) => p.qty, 'Aún no hay productos vendidos.', (p) => `${num.format(p.qty)} u · ${money.format(p.revenue)}`);

  host.querySelector('#fc-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget; const box = host.querySelector('#r-fc');
    btn.disabled = true; btn.textContent = 'Calculando…'; box.innerHTML = '<div class="spinner">Consultando a la IA…</div>';
    try {
      const f = await api.forecast(7);
      const items = (f.forecast || []).map((d) => `<div class="row"><span class="name">${esc(d.date)}</span><span class="amt">${money.format(d.expectedRevenue)}</span></div>`).join('');
      box.innerHTML = `<p class="muted" style="margin:0 0 12px">${esc(f.summary || '')}</p>${items ? `<div class="rows">${items}</div>` : '<div class="empty">Sin datos para proyectar.</div>'}`;
    } catch (ex) {
      box.innerHTML = `<div class="empty">${esc(ex.status === 503 ? 'La IA no está configurada (falta ANTHROPIC_API_KEY).' : ex.message)}</div>`;
    } finally { btn.disabled = false; btn.textContent = 'Proyectar 7 días'; }
  });
}

function barsChart(data, emptyMsg) {
  if (!data.length) return `<div class="empty">${emptyMsg}</div>`;
  const d = data.slice(-14); const max = Math.max(...d.map((x) => x.revenue), 1);
  return `<div class="bars">${d.map((x) => `<div class="col" title="${esc(x.date)}: ${money.format(x.revenue)}"><div class="bar" style="height:${Math.round((x.revenue / max) * 100)}%"></div><div class="tick">${x.date.slice(8, 10)}</div></div>`).join('')}</div>`;
}
function listChart(data, name, val, emptyMsg, amtFmt) {
  if (!data.length) return `<div class="empty">${emptyMsg}</div>`;
  const max = Math.max(...data.map(val), 1);
  return `<div class="rows">${data.map((x) => `<div class="row"><span class="name">${esc(name(x))}</span><span class="amt">${amtFmt ? amtFmt(x) : money.format(val(x))}</span><div class="track"><div class="fill" style="width:${Math.round((val(x) / max) * 100)}%"></div></div></div>`).join('')}</div>`;
}

/* ===================== MENÚ (PRODUCTOS) ===================== */
export async function renderMenu(host) {
  loading(host);
  let items;
  try { items = await productsApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderMenu(host);

  const openForm = (p) => formModal({
    title: p ? 'Editar producto' : 'Nuevo producto',
    submitLabel: p ? 'Guardar' : 'Crear',
    values: p || { available: true },
    fields: [
      { name: 'name', label: 'Nombre', required: true },
      { name: 'price', label: 'Precio', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'cost', label: 'Costo (opcional)', type: 'number', step: '0.01', min: 0, help: 'Para calcular tu margen' },
      { name: 'category', label: 'Categoría', placeholder: 'Ej. Pizzas, Bebidas' },
      { name: 'description', label: 'Descripción', type: 'textarea' },
      { name: 'available', label: 'Disponible', type: 'checkbox' },
    ],
    onSubmit: async (v) => { p ? await productsApi.update(p._id, v) : await productsApi.create(v); toast(p ? 'Producto actualizado' : 'Producto creado', 'success'); reload(); },
  });

  host.innerHTML = `
    <div class="view-head"><h1>Menú</h1><button class="btn btn-accent" id="add">+ Agregar producto</button></div>
    ${!items.length ? '<div class="panel"><div class="empty">Tu carta está vacía. Agregá tu primer producto para publicarlo en la landing.</div></div>'
    : `<div class="list">${items.map((p) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${esc(p.name)} ${p.available === false ? '<span class="badge badge-muted">No disponible</span>' : ''}</div>
          <div class="li-sub">${esc(p.category || 'Sin categoría')}${p.description ? ' · ' + esc(p.description) : ''}</div>
          ${p.cost && p.price > 0 ? `<div class="li-sub">Costo ${money.format(p.cost)} · Margen ${money.format(p.price - p.cost)} (${Math.round((1 - p.cost / p.price) * 100)}%)</div>` : ''}
        </div>
        <div class="li-amt">${money.format(p.price)}</div>
        <div class="li-actions">
          <button class="btn btn-sm" data-edit="${p._id}">Editar</button>
          <button class="btn btn-sm btn-danger" data-del="${p._id}">Eliminar</button>
        </div>
      </div>`).join('')}</div>`}`;

  host.querySelector('#add').addEventListener('click', () => openForm(null));
  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(items.find((x) => x._id === b.dataset.edit))));
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const p = items.find((x) => x._id === b.dataset.del);
    if (await confirmDialog(`¿Eliminar "${p.name}"?`)) { await productsApi.remove(p._id); toast('Producto eliminado', 'success'); reload(); }
  }));
}

/* ===================== PEDIDOS ===================== */
export async function renderPedidos(host) {
  loading(host);
  let items;
  try { items = await ordersApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderPedidos(host);

  host.innerHTML = `
    <div class="view-head"><h1>Pedidos</h1><div style="display:flex;gap:10px;align-items:center"><span class="live">● En vivo</span><button class="btn btn-sm" id="refresh">Actualizar</button></div></div>
    ${!items.length ? '<div class="panel"><div class="empty">No hay pedidos activos. Los pedidos de la landing, WhatsApp y delivery aparecen acá.</div></div>'
    : `<div class="list">${items.map((o) => {
      const next = nextStatus(o.status);
      const itemsTxt = (o.items || []).map((i) => `${i.qty}× ${esc(i.name || '')}`).join(', ');
      return `<div class="list-item order">
        <div class="li-main">
          <div class="li-title">#${esc(o.code)} <span class="badge badge-status st-${o.status}">${ORDER_LABEL[o.status] || o.status}</span> <span class="badge badge-muted">${esc(o.channel)}</span></div>
          <div class="li-sub">${esc(o.customer?.name || 'Cliente')}${o.customer?.phone ? ' · ' + esc(o.customer.phone) : ''}${itemsTxt ? ' — ' + itemsTxt : ''}</div>
        </div>
        <div class="li-amt">${money.format(o.total)}</div>
        <div class="li-actions">
          ${next ? `<button class="btn btn-sm btn-accent" data-next="${o._id}" data-to="${next}">${ORDER_LABEL[next]} ▸</button>` : ''}
          ${o.status !== 'cancelled' && o.status !== 'delivered' ? `<button class="btn btn-sm btn-danger" data-cancel="${o._id}">Cancelar</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`}`;

  host.querySelector('#refresh').addEventListener('click', reload);
  host.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    await ordersApi.setStatus(b.dataset.next, b.dataset.to); toast(`Pedido → ${ORDER_LABEL[b.dataset.to]}`, 'success'); reload();
  }));
  host.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Cancelar este pedido?')) { await ordersApi.setStatus(b.dataset.cancel, 'cancelled'); toast('Pedido cancelado', 'success'); reload(); }
  }));

  // Auto-refresco mientras la pestaña esté visible (cocina en vivo).
  onInterval(() => { if (document.visibilityState === 'visible' && document.body.contains(host)) renderPedidos(host); }, 20000);
}

/* ===================== GASTOS ===================== */
export async function renderGastos(host) {
  loading(host);
  let items;
  try { items = await expensesApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderGastos(host);

  const openForm = () => formModal({
    title: 'Cargar gasto',
    submitLabel: 'Guardar',
    values: { date: new Date().toISOString().slice(0, 10), category: 'supplies' },
    fields: [
      { name: 'vendor', label: 'Proveedor' },
      { name: 'total', label: 'Total', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'category', label: 'Categoría', type: 'select', options: EXP_CATS },
      { name: 'date', label: 'Fecha', type: 'date' },
    ],
    onSubmit: async (v) => { await expensesApi.create(v); toast('Gasto cargado', 'success'); reload(); },
  });

  host.innerHTML = `
    <div class="view-head">
      <h1>Gastos</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="export">Descargar CSV</button>
        <button class="btn" id="import">Importar CSV</button>
        <button class="btn" id="ocr">📷 Cargar por foto</button>
        <button class="btn btn-accent" id="add">+ Cargar gasto</button>
        <input type="file" accept="image/*" id="ocr-file" hidden />
        <input type="file" accept=".csv,text/csv" id="csv-file" hidden />
      </div>
    </div>
    ${!items.length ? '<div class="panel"><div class="empty">Sin gastos cargados. Cargá uno manual o sacale una foto a la factura.</div></div>'
    : `<div class="list">${items.map((x) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${esc(x.vendor || 'Gasto')} ${x.ocrStatus === 'review' ? '<span class="badge badge-warn">Revisar (OCR)</span>' : ''}</div>
          <div class="li-sub">${esc(CAT_ES[x.category] || x.category || 'Otros')} · ${new Date(x.date).toLocaleDateString('es-AR')}</div>
        </div>
        <div class="li-amt">${money.format(x.total)}</div>
        <div class="li-actions"><button class="btn btn-sm btn-danger" data-del="${x._id}">Eliminar</button></div>
      </div>`).join('')}</div>`}`;

  host.querySelector('#add').addEventListener('click', openForm);
  const fileInput = host.querySelector('#ocr-file');
  host.querySelector('#ocr').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    toast('Procesando factura con IA…', 'info');
    try { await uploadExpenseOcr(file); toast('Gasto creado desde la foto (revisalo)', 'success'); reload(); }
    catch (ex) { toast(ex.status === 503 ? 'Falta configurar ANTHROPIC_API_KEY' : (ex.message || 'No se pudo leer la foto'), 'error'); }
  });
  host.querySelector('#export').addEventListener('click', () => downloadExpensesCSV(items));
  const csvInput = host.querySelector('#csv-file');
  host.querySelector('#import').addEventListener('click', () => csvInput.click());
  csvInput.addEventListener('change', async () => {
    const file = csvInput.files[0]; if (!file) return;
    const rows = parseExpensesCSV(await file.text());
    if (!rows.length) { toast('No se encontraron filas válidas', 'error'); return; }
    toast(`Importando ${rows.length}…`, 'info');
    let ok = 0;
    for (const r of rows) {
      try { await expensesApi.create({ vendor: r.vendor || undefined, total: r.total, category: EXP_VALID.has(r.category) ? r.category : undefined, date: r.date || undefined }); ok += 1; } catch {}
    }
    toast(`${ok} gastos importados`, 'success'); reload();
  });
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Eliminar este gasto?')) { await expensesApi.remove(b.dataset.del); toast('Gasto eliminado', 'success'); reload(); }
  }));
}

// --- CSV de gastos (export/import client-side) ---
function downloadExpensesCSV(rows) {
  const cell = (s) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const lines = ['fecha,proveedor,categoria,total,moneda'];
  for (const x of rows) {
    lines.push([new Date(x.date).toISOString().slice(0, 10), cell(x.vendor || ''), x.category || 'other', x.total ?? 0, x.currency || 'ARS'].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'gastos.csv'; a.click();
  URL.revokeObjectURL(a.href);
}

function splitCSVLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseExpensesCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names) => header.findIndex((h) => names.includes(h));
  const iDate = idx(['fecha', 'date']); const iVendor = idx(['proveedor', 'vendor']);
  const iCat = idx(['categoria', 'category', 'categoría']); const iTotal = idx(['total', 'monto', 'importe']);
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCSVLine(lines[i]);
    const total = Number(String(iTotal >= 0 ? c[iTotal] : '').replace(/[^0-9.,-]/g, '').replace(',', '.'));
    if (!total) continue;
    out.push({
      date: iDate >= 0 ? (c[iDate] || '').trim() : undefined,
      vendor: iVendor >= 0 ? (c[iVendor] || '').trim() : undefined,
      category: iCat >= 0 ? (c[iCat] || '').trim().toLowerCase() : undefined,
      total,
    });
  }
  return out;
}

/* ===================== AJUSTES ===================== */
export async function renderAjustes(host) {
  loading(host);
  let tenant; let user;
  try { const [t, m] = await Promise.all([tenantApi.get(), me()]); tenant = t; user = m.user; }
  catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const storeUrl = `${location.origin}/r/${tenant.slug}`;
  const ig = tenant.integrations || {};
  const badge = (c) => (c ? '<span class="badge" style="color:var(--success)">Conectado</span>' : '<span class="badge badge-muted">Sin conectar</span>');

  host.innerHTML = `
    <div class="view-head"><h1>Ajustes</h1><button class="btn btn-accent" id="edit-biz">Editar comercio</button></div>
    <div class="panel">
      <h2>Tu landing pública</h2>
      <p class="muted" style="margin:0 0 10px">La página donde tus clientes ven la carta y hacen pedidos. Compartila por WhatsApp o Instagram.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-sm btn-accent" href="${esc(storeUrl)}" target="_blank" rel="noopener">Ver mi landing ↗</a>
        <button class="btn btn-sm" id="copy-link">Copiar link</button>
      </div>
      <div class="mono" style="font-size:12px;color:var(--text-muted);margin-top:8px;word-break:break-all">${esc(storeUrl)}</div>
    </div>
    <div class="panel">
      <h2>Comercio</h2>
      <div class="kv"><span>Nombre</span><strong>${esc(tenant.name)}</strong></div>
      <div class="kv"><span>Slug</span><strong class="mono">${esc(tenant.slug)}</strong></div>
      <div class="kv"><span>Plan</span><strong>${esc(tenant.plan || 'free')}</strong></div>
      <div class="kv"><span>Moneda</span><strong>${esc(tenant.settings?.currency || 'ARS')}</strong></div>
    </div>
    <div class="panel">
      <h2>Integraciones</h2>
      <p class="muted" style="margin:0 0 12px">Conectá tus cuentas. Los tokens se guardan cifrados y no se vuelven a mostrar.</p>
      <div class="kv"><span>WhatsApp Business</span><span style="display:flex;gap:8px;align-items:center">${badge(ig.whatsapp?.connected)}<button class="btn btn-sm" data-cfg="whatsapp">Configurar</button></span></div>
      <div class="kv"><span>Instagram</span><span style="display:flex;gap:8px;align-items:center">${badge(ig.instagram?.connected)}<button class="btn btn-sm" data-cfg="instagram">Configurar</button></span></div>
      <div class="kv"><span>Mercado Pago</span><span style="display:flex;gap:8px;align-items:center">${badge(ig.mercadopago?.connected)}<button class="btn btn-sm" data-cfg="mercadopago">Configurar</button></span></div>
    </div>
    <div class="panel">
      <h2>Usuario</h2>
      <div class="kv"><span>Email</span><strong>${esc(user.email)}</strong></div>
      <div class="kv"><span>Rol</span><strong>${esc(user.role)}</strong></div>
    </div>`;

  host.querySelector('#copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(storeUrl); toast('Link copiado', 'success'); }
    catch { toast('Copiá el link de abajo', 'info'); }
  });

  host.querySelector('#edit-biz')?.addEventListener('click', () => formModal({
    title: 'Editar comercio',
    submitLabel: 'Guardar',
    fields: [
      { name: 'name', label: 'Nombre del comercio', required: true, value: tenant.name },
      { name: 'description', label: 'Descripción (aparece en tu landing)', type: 'textarea', value: tenant.branding?.description },
      { name: 'accent', label: 'Color principal', type: 'color', value: tenant.branding?.colors?.accent || '#c0392b' },
      { name: 'logo', label: 'Logo (URL de imagen)', value: tenant.branding?.logo, placeholder: 'https://…' },
      { name: 'currency', label: 'Moneda', value: tenant.settings?.currency || 'ARS' },
    ],
    onSubmit: async (v) => {
      await tenantApi.update({
        name: v.name,
        settings: { currency: v.currency },
        branding: { description: v.description, logo: v.logo || '', colors: { accent: v.accent } },
      });
      toast('Comercio actualizado', 'success');
      renderAjustes(host);
    },
  }));

  // Omite campos vacíos (un token en blanco = no cambiar, no borrar).
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
  const CFG = {
    whatsapp: {
      title: 'WhatsApp Business',
      fields: [
        { name: 'phoneId', label: 'Phone Number ID', value: ig.whatsapp?.phoneId },
        { name: 'wabaId', label: 'WABA ID', value: ig.whatsapp?.wabaId },
        { name: 'token', label: 'Token de acceso', type: 'password', placeholder: ig.whatsapp?.connected ? '•••• (dejar vacío para no cambiar)' : 'Pegá el token', help: 'Se guarda cifrado.' },
      ],
      build: (v) => ({ whatsapp: clean({ phoneId: v.phoneId, wabaId: v.wabaId, token: v.token }) }),
    },
    instagram: {
      title: 'Instagram',
      fields: [
        { name: 'igUserId', label: 'IG User ID', value: ig.instagram?.igUserId },
        { name: 'token', label: 'Token de acceso', type: 'password', placeholder: ig.instagram?.connected ? '•••• (dejar vacío para no cambiar)' : 'Pegá el token', help: 'Se guarda cifrado.' },
      ],
      build: (v) => ({ instagram: clean({ igUserId: v.igUserId, token: v.token }) }),
    },
    mercadopago: {
      title: 'Mercado Pago',
      fields: [
        { name: 'publicKey', label: 'Public key', value: ig.mercadopago?.publicKey },
        { name: 'accessToken', label: 'Access token', type: 'password', placeholder: ig.mercadopago?.connected ? '•••• (dejar vacío para no cambiar)' : 'Pegá el access token', help: 'Se guarda cifrado.' },
        { name: 'webhookSecret', label: 'Webhook secret', type: 'password', placeholder: ig.mercadopago?.webhookConfigured ? '••••' : 'Opcional', help: 'Para validar la firma de los webhooks.' },
      ],
      build: (v) => ({ mercadopago: clean({ publicKey: v.publicKey, accessToken: v.accessToken, webhookSecret: v.webhookSecret }) }),
    },
  };
  host.querySelectorAll('[data-cfg]').forEach((b) => b.addEventListener('click', () => {
    const c = CFG[b.dataset.cfg];
    formModal({
      title: c.title, submitLabel: 'Guardar', fields: c.fields,
      onSubmit: async (v) => { await tenantApi.update({ integrations: c.build(v) }); toast('Integración guardada', 'success'); renderAjustes(host); },
    });
  }));
}

/* ===================== CAMPAÑAS ===================== */
const hashes = (arr) => (arr || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');

export async function renderCampanias(host) {
  loading(host);
  let items;
  try { items = await campaignsApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderCampanias(host);

  const openForm = (preset) => formModal({
    title: 'Nueva campaña', submitLabel: 'Crear',
    values: preset || { channel: 'instagram', status: 'draft' },
    fields: [
      { name: 'channel', label: 'Canal', type: 'select', options: [{ value: 'instagram', label: 'Instagram' }, { value: 'whatsapp', label: 'WhatsApp' }] },
      { name: 'type', label: 'Tipo', placeholder: 'Ej. promo, lanzamiento' },
      { name: 'content', label: 'Contenido', type: 'textarea' },
      { name: 'scheduledAt', label: 'Programar (opcional)', type: 'date' },
    ],
    onSubmit: async (v) => { await campaignsApi.create(v); toast('Campaña creada', 'success'); reload(); },
  });

  host.innerHTML = `
    <div class="view-head"><h1>Campañas</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="suggest">✨ Sugerir con IA</button>
        <button class="btn btn-accent" id="add">+ Nueva campaña</button>
      </div>
    </div>
    <div id="ideas"></div>
    ${!items.length ? '<div class="panel"><div class="empty">Sin campañas. Creá una o pedí ideas a la IA.</div></div>'
    : `<div class="list">${items.map((c) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${esc(c.type || 'Campaña')} <span class="badge badge-muted">${esc(c.channel)}</span> <span class="badge badge-muted">${esc(c.status)}</span></div>
          <div class="li-sub">${esc((c.content || '').slice(0, 160))}${c.scheduledAt ? ' · ' + new Date(c.scheduledAt).toLocaleDateString('es-AR') : ''}</div>
        </div>
        <div class="li-actions"><button class="btn btn-sm btn-danger" data-del="${c._id}">Eliminar</button></div>
      </div>`).join('')}</div>`}`;

  host.querySelector('#add').addEventListener('click', () => openForm());
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Eliminar esta campaña?')) { await campaignsApi.remove(b.dataset.del); toast('Campaña eliminada', 'success'); reload(); }
  }));

  host.querySelector('#suggest').addEventListener('click', async (e) => {
    const btn = e.currentTarget; const box = host.querySelector('#ideas');
    btn.disabled = true; btn.textContent = 'Pensando…'; box.innerHTML = '<div class="spinner">La IA está creando ideas…</div>';
    try {
      const data = await campaignsApi.suggest();
      const posts = data.posts || [];
      box.innerHTML = posts.length ? `<div class="panel"><h2>Ideas para Instagram</h2><div class="rows">${posts.map((p, i) => `
        <div class="idea">
          <div style="white-space:pre-wrap">${esc(p.caption)}</div>
          <div class="muted" style="font-size:12px;margin-top:6px">${esc(hashes(p.hashtags))}</div>
          <div class="muted" style="font-size:12px;margin-top:4px">📸 ${esc(p.idea)}</div>
          <button class="btn btn-sm" data-use="${i}" style="margin-top:10px">Usar como campaña</button>
        </div>`).join('')}</div></div>` : '<div class="empty">Sin ideas.</div>';
      box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
        const p = posts[Number(b.dataset.use)];
        openForm({ channel: 'instagram', status: 'draft', type: 'post IG', content: `${p.caption}\n\n${hashes(p.hashtags)}` });
      }));
    } catch (ex) {
      box.innerHTML = `<div class="empty">${esc(ex.status === 503 ? 'La IA no está configurada (falta ANTHROPIC_API_KEY).' : ex.message)}</div>`;
    } finally { btn.disabled = false; btn.textContent = '✨ Sugerir con IA'; }
  });
}
