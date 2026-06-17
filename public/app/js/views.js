import { api, me, productsApi, ordersApi, expensesApi, uploadExpenseOcr } from './api.js';
import { money, num, esc, formModal, confirmDialog, toast } from './ui.js';

const CAT_ES = { supplies: 'Insumos', rent: 'Alquiler', salary: 'Sueldos', utilities: 'Servicios', other: 'Otros' };
const EXP_CATS = Object.entries(CAT_ES).map(([value, label]) => ({ value, label }));

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
    <div class="view-head"><h1>Pedidos</h1><button class="btn btn-sm" id="refresh">Actualizar</button></div>
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
        <button class="btn" id="ocr">📷 Cargar por foto</button>
        <button class="btn btn-accent" id="add">+ Cargar gasto</button>
        <input type="file" accept="image/*" id="ocr-file" hidden />
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
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Eliminar este gasto?')) { await expensesApi.remove(b.dataset.del); toast('Gasto eliminado', 'success'); reload(); }
  }));
}

/* ===================== AJUSTES ===================== */
export async function renderAjustes(host) {
  loading(host);
  let data;
  try { data = await me(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const { tenant, user } = data;
  const menuUrl = `${location.origin}/api/public/${tenant.slug}/menu`;

  host.innerHTML = `
    <div class="view-head"><h1>Ajustes</h1></div>
    <div class="panel">
      <h2>Comercio</h2>
      <div class="kv"><span>Nombre</span><strong>${esc(tenant.name)}</strong></div>
      <div class="kv"><span>Slug</span><strong class="mono">${esc(tenant.slug)}</strong></div>
      <div class="kv"><span>Plan</span><strong>${esc(tenant.plan || 'free')}</strong></div>
      <div class="kv"><span>Moneda</span><strong>${esc(tenant.settings?.currency || 'ARS')}</strong></div>
    </div>
    <div class="panel">
      <h2>Usuario</h2>
      <div class="kv"><span>Email</span><strong>${esc(user.email)}</strong></div>
      <div class="kv"><span>Rol</span><strong>${esc(user.role)}</strong></div>
    </div>
    <div class="panel">
      <h2>Menú público</h2>
      <p class="muted" style="margin:0 0 10px">Endpoint del menú de tu comercio (la landing visual por slug llega en una próxima fase).</p>
      <a class="btn btn-sm" href="${esc(menuUrl)}" target="_blank" rel="noopener">Ver menú público (JSON)</a>
    </div>`;
}
