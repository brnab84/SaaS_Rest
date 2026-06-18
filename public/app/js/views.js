import { api, me, tenantApi, productsApi, ordersApi, expensesApi, campaignsApi, uploadExpenseOcr, importProducts, uploadImage, productFromPhoto } from './api.js';
import { money, num, esc, formModal, confirmDialog, toast, onInterval, clearTimers, playPing, pushNotify, requestNotifyPermission, soundEnabled, setSoundEnabled, getTone, setTone } from './ui.js';
import { renderThemePicker } from './themes.js';

const CAT_ES = { supplies: 'Insumos', rent: 'Alquiler', salary: 'Sueldos', utilities: 'Servicios', other: 'Otros' };
const EXP_CATS = Object.entries(CAT_ES).map(([value, label]) => ({ value, label }));
const EXP_VALID = new Set(Object.keys(CAT_ES));

const ORDER_FLOW = ['new', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered'];
const ORDER_LABEL = { new: 'Nuevo', confirmed: 'Confirmado', preparing: 'En cocina', ready: 'Listo', on_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado' };
// Mensajes parametrizables que se envían al cliente por WhatsApp en cada estado (deben coincidir con el backend).
const MSG_LABELS = { confirmed: 'Confirmado', preparing: 'En cocina', ready: 'Listo', on_way: 'En camino', delivered: 'Entregado' };
const DEFAULT_MSG = { confirmed: 'Confirmamos tu pedido ✅', preparing: 'Tu pedido está en marcha 👨‍🍳', ready: '¡Tu pedido está listo! ✅', on_way: 'Tu pedido va en camino 🛵', delivered: '¡Gracias por tu compra! 🙌' };
const TONE_LABELS = { campana: 'Campana', timbre: 'Timbre', arpa: 'Arpa' };
const nextStatus = (s) => { const i = ORDER_FLOW.indexOf(s); return i >= 0 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null; };

// Para avisar de pedidos nuevos: recordamos los ids ya vistos en esta sesión (null = primera carga).
let _seenOrderIds = null;
const waNumber = (phone) => String(phone || '').replace(/\D/g, '');
const waReply = (o) => `Hola ${o.customer?.name || ''}! Te escribimos por tu pedido #${o.code}.`;

const loading = (host) => { host.innerHTML = '<div class="spinner">Cargando…</div>'; };

/* ===================== RESUMEN ===================== */
export async function renderResumen(host) {
  host.innerHTML = `
    <div class="view-head"><h1>Resumen</h1><span class="muted">últimos 30 días</span></div>
    <p class="help">Vista general de tu negocio: ventas cobradas, pedidos, gastos y ganancia de los últimos 30 días. Los números se llenan a medida que cargás productos y entran pedidos.</p>
    <div id="kpis" class="kpi-grid"><div class="spinner">Cargando…</div></div>
    <div class="panel-grid">
      <div class="panel"><h2>Ventas por día</h2><div id="r-sales">—</div></div>
      <div class="panel"><h2>Gastos por categoría</h2><div id="r-exp">—</div></div>
    </div>
    <div class="panel"><h2>Productos más vendidos</h2><div id="r-prod">—</div></div>
    <div class="panel">
      <div class="panel-head"><h2>Pronóstico de ventas (IA)</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="input" id="fc-days" style="width:auto;min-height:38px;padding:6px 10px">
            <option value="7">7 días</option><option value="14">14 días</option><option value="30">30 días</option>
          </select>
          <button class="btn btn-accent" id="fc-btn">Proyectar</button>
        </div>
      </div>
      <p class="help" style="margin-top:8px">Cómo funciona: la IA mira tu histórico de pedidos ya cobrados y estima cuánto venderías los próximos días (considera tendencia y día de la semana). <strong>1)</strong> Elegí el horizonte (7, 14 o 30 días). <strong>2)</strong> Tocá "Proyectar". Necesitás al menos una semana con ventas y la clave de IA activada.</p>
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
    const days = Number(host.querySelector('#fc-days')?.value) || 7;
    btn.disabled = true; btn.textContent = 'Calculando…'; box.innerHTML = '<div class="spinner">Consultando a la IA…</div>';
    try {
      const f = await api.forecast(days);
      const items = (f.forecast || []).map((d) => `<div class="row"><span class="name">${esc(d.date)}</span><span class="amt">${money.format(d.expectedRevenue)}</span></div>`).join('');
      box.innerHTML = `<p class="muted" style="margin:0 0 12px">${esc(f.summary || '')}</p>${items ? `<div class="rows">${items}</div>` : '<div class="empty">Sin datos para proyectar.</div>'}`;
    } catch (ex) {
      box.innerHTML = `<div class="empty">${esc(ex.status === 503 ? 'La IA no está configurada (falta ANTHROPIC_API_KEY).' : ex.message)}</div>`;
    } finally { btn.disabled = false; btn.textContent = 'Proyectar'; }
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
  let items; let tenant;
  try { const [p, t] = await Promise.all([productsApi.list(), tenantApi.get()]); items = p; tenant = t; }
  catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderMenu(host);
  // Categorías para el dropdown: las definidas por el comercio + las ya usadas en productos.
  const cats = [...new Set([...(tenant.settings?.categories || []), ...items.map((p) => p.category).filter(Boolean)])];

  const openForm = (p) => {
    if (p?.category && !cats.includes(p.category)) cats.push(p.category);
    return formModal({
      title: p?._id ? 'Editar producto' : 'Nuevo producto',
      submitLabel: p?._id ? 'Guardar' : 'Crear',
      values: p || { available: true },
      fields: [
        { name: 'name', label: 'Nombre', required: true },
        { name: 'price', label: 'Precio', type: 'number', step: '0.01', min: 0, required: true },
        { name: 'cost', label: 'Costo (opcional)', type: 'number', step: '0.01', min: 0, help: 'Para calcular tu margen' },
        { name: 'category', label: 'Categoría', type: 'select', options: [{ value: '', label: '(sin categoría)' }, ...cats.map((c) => ({ value: c, label: c }))] },
        { name: 'description', label: 'Descripción', type: 'textarea' },
        { name: 'photoFile', label: 'Foto del plato', type: 'file', accept: 'image/*', help: 'Subí una imagen (o pegá una URL abajo)' },
        { name: 'photo', label: 'Foto (URL, opcional)', placeholder: 'https://…' },
        { name: 'available', label: 'Disponible', type: 'checkbox' },
      ],
      onSubmit: async (v) => {
        if (v.photoFile) { const r = await uploadImage(v.photoFile); v.photo = r.url; }
        delete v.photoFile;
        if (p?._id) await productsApi.update(p._id, v); else await productsApi.create(v);
        toast(p?._id ? 'Producto actualizado' : 'Producto creado', 'success'); reload();
      },
    });
  };

  // Agrupar por categoría para navegación (chips → secciones)
  const groups = {};
  for (const p of items) { const c = p.category || 'Sin categoría'; (groups[c] ||= []).push(p); }
  const groupNames = Object.keys(groups);
  const prodRow = (p) => `
      <div class="list-item">
        ${p.photo ? `<img class="thumb" src="${esc(p.photo)}" alt="" loading="lazy" />` : ''}
        <div class="li-main">
          <div class="li-title">${esc(p.name)} ${p.available === false ? '<span class="badge badge-muted">No disponible</span>' : ''}</div>
          <div class="li-sub">${esc(p.category || 'Sin categoría')}${p.description ? ' · ' + esc(p.description) : ''}</div>
          ${p.cost && p.price > 0 ? `<div class="li-sub">Costo ${money.format(p.cost)} · Margen ${money.format(p.price - p.cost)} (${Math.round((1 - p.cost / p.price) * 100)}%)</div>` : ''}
        </div>
        <div class="li-amt">${money.format(p.price)}</div>
        <div class="li-actions">
          <button class="btn btn-sm" data-dup="${p._id}">Duplicar</button>
          <button class="btn btn-sm" data-edit="${p._id}">Editar</button>
          <button class="btn btn-sm btn-danger" data-del="${p._id}">Eliminar</button>
        </div>
      </div>`;

  host.innerHTML = `
    <div class="view-head"><h1>Menú</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="from-photo">📷 Desde foto</button>
        <button class="btn" id="share-wa">Compartir por WhatsApp</button>
        <button class="btn" id="import-ai">Importar con IA</button>
        <button class="btn" id="import-prod">Importar CSV</button>
        <button class="btn btn-accent" id="add">+ Agregar producto</button>
        <input type="file" accept=".csv,text/csv" id="prod-csv" hidden />
      </div>
    </div>
    <p class="help">Tu carta. Tocá <strong>"+ Agregar producto"</strong> y completá nombre y precio (el costo es opcional y sirve para ver tu margen). Con <strong>"📷 Desde foto"</strong> la IA crea el producto a partir de una imagen. Los productos disponibles aparecen en tu landing pública.</p>
    ${!items.length ? '<div class="panel"><div class="empty">Tu carta está vacía. Agregá tu primer producto para publicarlo en la landing.</div></div>'
    : `${groupNames.length > 1 ? `<div class="catnav">${groupNames.map((c, i) => `<button class="chip" data-sec="msec-${i}">${esc(c)}</button>`).join('')}</div>` : ''}
    ${groupNames.map((c, i) => `<div class="cat-group" id="msec-${i}"><div class="cat-h">${esc(c)} <span class="muted">· ${groups[c].length}</span></div><div class="list">${groups[c].map(prodRow).join('')}</div></div>`).join('')}`}`;

  host.querySelectorAll('.catnav .chip').forEach((b) => b.addEventListener('click', () => host.querySelector(`#${b.dataset.sec}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  host.querySelector('#add').addEventListener('click', () => openForm(null));
  host.querySelector('#from-photo').addEventListener('click', () => formModal({
    title: 'Crear artículo desde foto',
    submitLabel: 'Analizar con IA',
    fields: [
      { name: 'file', label: 'Foto del plato', type: 'file', accept: 'image/*', required: true, help: 'La IA detecta el nombre, una descripción y sugiere categoría. Vos confirmás el precio.' },
    ],
    onSubmit: async (v) => {
      if (!v.file) throw new Error('Subí una foto');
      toast('Analizando la foto con IA…', 'info');
      let data; let photoUrl = '';
      try {
        [data, photoUrl] = await Promise.all([
          productFromPhoto(v.file),
          uploadImage(v.file).then((r) => r.url).catch(() => ''),
        ]);
      } catch (ex) {
        throw new Error(ex.status === 503 ? 'La IA no está configurada (falta ANTHROPIC_API_KEY).' : (ex.message || 'No se pudo analizar la foto'));
      }
      // Abrimos el formulario prellenado para que el usuario confirme el precio y guarde.
      openForm({ name: data.name || '', description: data.description || '', category: data.category || '', available: true, photo: photoUrl });
    },
  }));
  host.querySelector('#share-wa').addEventListener('click', () => {
    const avail = items.filter((p) => p.available !== false);
    if (!avail.length) { toast('Cargá productos disponibles primero', 'info'); return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(buildMenuText(tenant, avail))}`, '_blank');
  });
  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(items.find((x) => x._id === b.dataset.edit))));
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const p = items.find((x) => x._id === b.dataset.del);
    if (await confirmDialog(`¿Eliminar "${p.name}"?`)) { await productsApi.remove(p._id); toast('Producto eliminado', 'success'); reload(); }
  }));
  host.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', async () => {
    const p = items.find((x) => x._id === b.dataset.dup);
    await productsApi.create({ name: `${p.name} (copia)`, price: p.price, cost: p.cost, category: p.category, description: p.description, photo: p.photo, available: p.available });
    toast('Producto duplicado', 'success'); reload();
  }));
  const prodCsv = host.querySelector('#prod-csv');
  host.querySelector('#import-prod').addEventListener('click', () => prodCsv.click());
  prodCsv.addEventListener('change', async () => {
    const file = prodCsv.files[0]; if (!file) return;
    const rows = parseProductsCSV(await file.text());
    if (!rows.length) { toast('No se encontraron filas válidas (columnas: nombre, precio, categoria)', 'error'); return; }
    toast(`Importando ${rows.length}…`, 'info');
    let ok = 0;
    for (const r of rows) { try { await productsApi.create({ name: r.name, price: r.price, category: r.category || undefined, available: true }); ok += 1; } catch {} }
    toast(`${ok} productos importados`, 'success'); reload();
  });

  host.querySelector('#import-ai').addEventListener('click', () => formModal({
    title: 'Importar menú con IA',
    submitLabel: 'Importar',
    fields: [
      { name: 'file', label: 'Subí tu menú (PDF o foto)', type: 'file', accept: 'application/pdf,image/*' },
      { name: 'text', label: '…o pegá el menú como texto', type: 'textarea', placeholder: 'Cada ítem con su nombre y precio (y su sección si querés)' },
    ],
    onSubmit: async (v) => {
      if (!v.file && !v.text) throw new Error('Subí un archivo o pegá el texto');
      toast('Leyendo el menú con IA…', 'info');
      try {
        const r = await importProducts({ file: v.file, text: v.text });
        toast(`${r.imported} productos importados`, 'success'); reload();
      } catch (ex) {
        throw new Error(ex.status === 503 ? 'La IA no está configurada (falta ANTHROPIC_API_KEY).' : (ex.message || 'No se pudo importar'));
      }
    },
  }));
}

/* ===================== PEDIDOS ===================== */
export async function renderPedidos(host, opts = {}) {
  clearTimers(); // un solo timer activo: evita el parpadeo por timers acumulados
  if (!opts.silent) loading(host);
  let items;
  try {
    items = await ordersApi.list();
  } catch (e) {
    if (!opts.silent) host.innerHTML = `<div class="empty">${esc(e.message)} — reintentando…</div>`;
    scheduleOrders(host); // se recupera solo en el próximo ciclo
    return;
  }
  const reload = () => renderPedidos(host);

  // Aviso de pedidos nuevos (sonido + notificación), solo después de la primera carga de la sesión.
  if (_seenOrderIds === null) {
    _seenOrderIds = new Set(items.map((o) => o._id));
  } else {
    const fresh = items.filter((o) => o.status === 'new' && !_seenOrderIds.has(o._id));
    if (fresh.length) {
      playPing();
      const o = fresh[0];
      const extra = fresh.length > 1 ? ` (+${fresh.length - 1} más)` : '';
      pushNotify('Nuevo pedido', `#${o.code} · ${o.customer?.name || 'Cliente'} · ${money.format(o.total)}${extra}`);
      toast(`🔔 Nuevo pedido #${o.code}${extra}`, 'success');
    }
    for (const o of items) _seenOrderIds.add(o._id);
  }

  host.innerHTML = `
    <div class="view-head"><h1>Pedidos</h1><div style="display:flex;gap:10px;align-items:center"><span class="live">● En vivo</span><button class="btn btn-sm" id="refresh">Actualizar</button></div></div>
    <p class="help">Acá caen los pedidos de tu landing, WhatsApp y delivery. Tocá el botón azul para <strong>avanzar el estado</strong> (Nuevo → Confirmado → En cocina → Listo → En camino → Entregado); al cliente se le avisa por WhatsApp si tenés esa integración. La lista se actualiza sola cada 20 segundos.</p>
    ${!items.length ? '<div class="panel"><div class="empty">No hay pedidos activos. Los pedidos de la landing, WhatsApp y delivery aparecen acá.</div></div>'
    : `<div class="list">${items.map((o) => {
      const next = nextStatus(o.status);
      const paid = o.payment?.status === 'paid';
      const itemsTxt = (o.items || []).map((i) => `${i.qty}× ${esc(i.name || '')}`).join(', ');
      return `<div class="list-item order">
        <div class="li-main">
          <div class="li-title">#${esc(o.code)} <span class="badge badge-status st-${o.status}">${ORDER_LABEL[o.status] || o.status}</span> <span class="badge" style="color:${paid ? 'var(--success)' : 'var(--text-muted)'}">${paid ? 'Pagado' : 'A cobrar'}</span> <span class="badge badge-muted">${esc(o.channel)}</span></div>
          <div class="li-sub">${esc(o.customer?.name || 'Cliente')}${o.customer?.phone ? ' · ' + esc(o.customer.phone) : ''}${itemsTxt ? ' — ' + itemsTxt : ''}</div>
        </div>
        <div class="li-amt">${money.format(o.total)}</div>
        <div class="li-actions">
          ${o.customer?.phone ? `<a class="btn btn-sm" href="https://wa.me/${waNumber(o.customer.phone)}?text=${encodeURIComponent(waReply(o))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
          ${next ? `<button class="btn btn-sm btn-accent" data-next="${o._id}" data-to="${next}">${ORDER_LABEL[next]} ▸</button>` : ''}
          ${!paid && o.status !== 'cancelled' ? `<button class="btn btn-sm" data-pay="${o._id}">Cobrado</button>` : ''}
          ${o.status !== 'cancelled' && o.status !== 'delivered' ? `<button class="btn btn-sm btn-danger" data-cancel="${o._id}">Cancelar</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`}`;

  host.querySelector('#refresh').addEventListener('click', reload);
  host.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    await ordersApi.setStatus(b.dataset.next, b.dataset.to); toast(`Pedido → ${ORDER_LABEL[b.dataset.to]}`, 'success'); reload();
  }));
  host.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
    await ordersApi.pay(b.dataset.pay); toast('Marcado como cobrado · se suma a ventas', 'success'); reload();
  }));
  host.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Cancelar este pedido?')) { await ordersApi.setStatus(b.dataset.cancel, 'cancelled'); toast('Pedido cancelado', 'success'); reload(); }
  }));

  scheduleOrders(host);
}

// Un único timer de auto-refresco silencioso (sin spinner, sin acumular timers).
function scheduleOrders(host) {
  onInterval(() => {
    if (document.visibilityState === 'visible' && document.body.contains(host)) renderPedidos(host, { silent: true });
  }, 20000);
}

/* ===================== GASTOS ===================== */
export async function renderGastos(host) {
  loading(host);
  let items;
  try { items = await expensesApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderGastos(host);

  const openForm = (x) => formModal({
    title: x ? 'Editar gasto' : 'Cargar gasto',
    submitLabel: 'Guardar',
    values: x
      ? { vendor: x.vendor, total: x.total, category: x.category || 'other', date: new Date(x.date).toISOString().slice(0, 10) }
      : { date: new Date().toISOString().slice(0, 10), category: 'supplies' },
    fields: [
      { name: 'vendor', label: 'Proveedor' },
      { name: 'total', label: 'Total', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'category', label: 'Categoría', type: 'select', options: EXP_CATS },
      { name: 'date', label: 'Fecha', type: 'date' },
    ],
    onSubmit: async (v) => {
      if (x) {
        const patch = { ...v };
        if (x.ocrStatus === 'review') patch.ocrStatus = 'done'; // editar confirma el OCR
        await expensesApi.update(x._id, patch); toast('Gasto actualizado', 'success');
      } else { await expensesApi.create(v); toast('Gasto cargado', 'success'); }
      reload();
    },
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
    <p class="help">Registrá tus gastos de 4 formas: <strong>+ Cargar gasto</strong> (manual), <strong>📷 Cargar por foto</strong> (la IA lee la factura), <strong>Importar CSV</strong> (varios de una; en Excel usá "Guardar como CSV" con columnas fecha, proveedor, categoria, total) y <strong>Descargar CSV</strong> para llevarte todo.</p>
    ${!items.length ? '<div class="panel"><div class="empty">Sin gastos cargados. Cargá uno manual o sacale una foto a la factura.</div></div>'
    : `<div class="list">${items.map((x) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${esc(x.vendor || 'Gasto')} ${x.ocrStatus === 'review' ? '<span class="badge badge-warn">Revisar (OCR)</span>' : ''}</div>
          <div class="li-sub">${esc(CAT_ES[x.category] || x.category || 'Otros')} · ${new Date(x.date).toLocaleDateString('es-AR')}</div>
        </div>
        <div class="li-amt">${money.format(x.total)}</div>
        <div class="li-actions"><button class="btn btn-sm" data-edit="${x._id}">Editar</button><button class="btn btn-sm btn-danger" data-del="${x._id}">Eliminar</button></div>
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
  host.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(items.find((x) => x._id === b.dataset.edit))));
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Eliminar este gasto?')) { await expensesApi.remove(b.dataset.del); toast('Gasto eliminado', 'success'); reload(); }
  }));
}

// --- Compartir menú por WhatsApp ---
function buildMenuText(tenant, products) {
  const cats = {};
  for (const p of products) { const c = p.category || 'Menú'; (cats[c] ||= []).push(p); }
  let t = `🍽️ *${tenant.name}* — Menú\n`;
  for (const [cat, list] of Object.entries(cats)) {
    t += `\n*${cat}*\n`;
    for (const p of list) t += `• ${p.name} — ${money.format(p.price)}\n`;
  }
  t += `\n📲 Pedí online: ${location.origin}/r/${tenant.slug}`;
  return t;
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

function parseProductsCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names) => header.findIndex((h) => names.includes(h));
  const iName = idx(['nombre', 'name', 'producto']); const iPrice = idx(['precio', 'price']); const iCat = idx(['categoria', 'category', 'categoría', 'rubro']);
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCSVLine(lines[i]);
    const name = iName >= 0 ? (c[iName] || '').trim() : '';
    const price = Number(String(iPrice >= 0 ? c[iPrice] : '').replace(/[^0-9.,-]/g, '').replace(',', '.'));
    if (!name || !price) continue;
    out.push({ name, price, category: iCat >= 0 ? (c[iCat] || '').trim() : undefined });
  }
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
  const open = tenant.settings?.storeOpen !== false;
  const logoUrl = tenant.branding?.logo;
  const coverUrl = tenant.branding?.cover;
  const cats = tenant.settings?.categories || [];
  const om = tenant.settings?.orderMessages || {};
  const badge = (c) => (c ? '<span class="badge" style="color:var(--success)">Conectado</span>' : '<span class="badge badge-muted">Sin conectar</span>');

  host.innerHTML = `
    <div class="view-head"><h1>Ajustes</h1><button class="btn btn-accent" id="edit-biz">Editar comercio</button></div>
    <p class="help">Configurá tu comercio: estado, apariencia, datos, integraciones y tu landing pública.</p>
    <div class="panel">
      <h2>Estado de la tienda</h2>
      <p class="muted" style="margin:0 0 12px">Si está <strong>cerrada</strong>, tu landing muestra "Cerrado" y no acepta pedidos nuevos.</p>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="badge" style="color:${open ? 'var(--success)' : 'var(--danger)'}">${open ? '🟢 Abierta' : '🔴 Cerrada'}</span>
        <button class="btn ${open ? 'btn-danger' : 'btn-accent'}" id="toggle-store">${open ? 'Cerrar tienda' : 'Abrir tienda'}</button>
      </div>
    </div>
    <div class="panel">
      <h2>Apariencia (tema)</h2>
      <p class="muted" style="margin:0 0 12px">Elegí el tema visual del panel. Se guarda en tu comercio y <strong>tu landing pública usa el mismo tema</strong>.</p>
      <div id="theme-cfg"></div>
    </div>
    <div class="panel">
      <h2>Logo y portada</h2>
      <p class="muted" style="margin:0 0 14px">Tu logo y la imagen de portada de tu landing. Subí una imagen desde tu dispositivo.</p>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <div class="muted" style="font-size:12px;margin-bottom:6px">Logo</div>
          ${logoUrl ? `<img class="logo-prev" src="${esc(logoUrl)}" alt="logo" />` : '<div class="logo-prev placeholder">sin logo</div>'}
          <label class="btn btn-sm" style="display:inline-flex;margin-top:8px;cursor:pointer">${logoUrl ? 'Cambiar' : 'Subir'} logo<input type="file" accept="image/*" id="logo-input" hidden /></label>
        </div>
        <div>
          <div class="muted" style="font-size:12px;margin-bottom:6px">Portada</div>
          ${coverUrl ? `<div class="cover-prev" style="background-image:url('${esc(coverUrl)}')"></div>` : '<div class="cover-prev placeholder">sin portada</div>'}
          <label class="btn btn-sm" style="display:inline-flex;margin-top:8px;cursor:pointer">${coverUrl ? 'Cambiar' : 'Subir'} portada<input type="file" accept="image/*" id="cover-input" hidden /></label>
        </div>
      </div>
    </div>
    <div class="panel">
      <h2>Categorías del menú</h2>
      <p class="muted" style="margin:0 0 12px">Definí las secciones de tu carta. Aparecen como opciones al cargar productos y como filtros en tu landing.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${cats.length ? cats.map((c) => `<span class="badge badge-muted" style="display:inline-flex;align-items:center;gap:6px;font-size:13px">${esc(c)}<button data-rmcat="${esc(c)}" aria-label="Quitar" style="background:none;border:none;color:var(--danger);cursor:pointer;font-weight:700;font-size:14px;line-height:1">×</button></span>`).join('') : '<span class="muted" style="font-size:13px">Sin categorías todavía.</span>'}
      </div>
      <div style="display:flex;gap:8px">
        <input class="input" id="new-cat" placeholder="Nueva categoría (ej. Entradas)" style="flex:1" />
        <button class="btn btn-accent" id="add-cat">Agregar</button>
      </div>
    </div>
    <div class="panel">
      <h2>Notificaciones de pedidos</h2>
      <p class="muted" style="margin:0 0 12px">Cuando entra un pedido nuevo, la app suena y te avisa (tené la sección <strong>Pedidos</strong> abierta). Elegí el tono.</p>
      <label class="field-check"><input type="checkbox" id="snd-on" ${soundEnabled() ? 'checked' : ''}/> Sonido al recibir un pedido</label>
      <div class="field" style="margin-top:10px"><label>Tono</label>
        <select class="input" id="snd-tone">${Object.entries(TONE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-sm" id="snd-test">▶ Probar sonido</button>
        <button class="btn btn-sm" id="notif-perm">Activar avisos del sistema</button>
      </div>
    </div>
    <div class="panel">
      <h2>Mensajes a clientes (WhatsApp)</h2>
      <p class="muted" style="margin:0 0 12px">Personalizá lo que recibe el cliente por WhatsApp en cada estado del pedido. Si lo dejás vacío, se usa el texto por defecto. Requiere WhatsApp Business conectado.</p>
      ${Object.entries(MSG_LABELS).map(([k, label]) => `<div class="kv"><span>${label}</span><span class="muted" style="text-align:right;max-width:62%">${esc(om[k] || DEFAULT_MSG[k])}</span></div>`).join('')}
      <button class="btn btn-sm" id="edit-msgs" style="margin-top:12px">Editar mensajes</button>
    </div>
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

  renderThemePicker(host.querySelector('#theme-cfg'));

  const wireUpload = (inputId, field) => {
    host.querySelector(`#${inputId}`)?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      toast('Subiendo imagen…', 'info');
      try {
        const r = await uploadImage(file);
        await tenantApi.update({ branding: { [field]: r.url } });
        toast('Imagen actualizada', 'success'); renderAjustes(host);
      } catch (ex) { toast(ex.message || 'No se pudo subir', 'error'); }
    });
  };
  wireUpload('logo-input', 'logo');
  wireUpload('cover-input', 'cover');

  const saveCats = async (next) => {
    try { await tenantApi.update({ settings: { categories: next } }); renderAjustes(host); }
    catch (ex) { toast(ex.message || 'No se pudo guardar', 'error'); }
  };
  const newCat = host.querySelector('#new-cat');
  const addCat = () => {
    const v = (newCat.value || '').trim();
    if (!v) return;
    if (cats.some((c) => c.toLowerCase() === v.toLowerCase())) { toast('Esa categoría ya existe', 'info'); return; }
    saveCats([...cats, v]);
  };
  host.querySelector('#add-cat')?.addEventListener('click', addCat);
  newCat?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } });
  host.querySelectorAll('[data-rmcat]').forEach((b) => b.addEventListener('click', () => saveCats(cats.filter((c) => c !== b.dataset.rmcat))));

  // Notificaciones de pedidos (preferencias por dispositivo)
  const sndTone = host.querySelector('#snd-tone'); if (sndTone) sndTone.value = getTone();
  host.querySelector('#snd-on')?.addEventListener('change', (e) => { setSoundEnabled(e.target.checked); toast(e.target.checked ? 'Sonido activado' : 'Sonido desactivado', 'success'); });
  sndTone?.addEventListener('change', () => { setTone(sndTone.value); playPing(true); });
  host.querySelector('#snd-test')?.addEventListener('click', () => playPing(true));
  host.querySelector('#notif-perm')?.addEventListener('click', async () => {
    await requestNotifyPermission();
    const ok = 'Notification' in window && Notification.permission === 'granted';
    toast(ok ? 'Avisos del sistema activados' : 'No se concedió el permiso', ok ? 'success' : 'info');
  });

  // Mensajes a clientes por estado (WhatsApp)
  host.querySelector('#edit-msgs')?.addEventListener('click', () => formModal({
    title: 'Mensajes por estado',
    submitLabel: 'Guardar',
    fields: Object.entries(MSG_LABELS).map(([k, label]) => ({ name: k, label, type: 'textarea', value: om[k] || '', placeholder: DEFAULT_MSG[k] })),
    onSubmit: async (v) => { await tenantApi.update({ settings: { orderMessages: v } }); toast('Mensajes guardados', 'success'); renderAjustes(host); },
  }));

  host.querySelector('#toggle-store')?.addEventListener('click', async () => {
    try { await tenantApi.update({ settings: { storeOpen: !open } }); toast(open ? 'Tienda cerrada' : 'Tienda abierta', 'success'); renderAjustes(host); }
    catch (ex) { toast(ex.message || 'No se pudo cambiar el estado', 'error'); }
  });

  host.querySelector('#copy-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(storeUrl); toast('Link copiado', 'success'); }
    catch { toast('Copiá el link de abajo', 'info'); }
  });

  host.querySelector('#edit-biz')?.addEventListener('click', () => formModal({
    title: 'Editar comercio',
    submitLabel: 'Guardar',
    fields: [
      { name: 'name', label: 'Nombre del comercio', required: true, value: tenant.name },
      { name: 'cuisine', label: 'Rubro', value: tenant.branding?.cuisine, placeholder: 'Ej. Sushi, Empanadas, Pizza, China, Árabe, Parrilla' },
      { name: 'description', label: 'Descripción (aparece en tu landing)', type: 'textarea', value: tenant.branding?.description },
      { name: 'accent', label: 'Color principal', type: 'color', value: tenant.branding?.colors?.accent || '#c0392b' },
      { name: 'logoFile', label: 'Logo (subir imagen)', type: 'file', accept: 'image/*' },
      { name: 'logo', label: 'Logo (o URL)', value: tenant.branding?.logo, placeholder: 'https://…' },
      { name: 'coverFile', label: 'Portada (subir imagen)', type: 'file', accept: 'image/*' },
      { name: 'cover', label: 'Portada (o URL)', value: tenant.branding?.cover, placeholder: 'https://…' },
      { name: 'currency', label: 'Moneda', value: tenant.settings?.currency || 'ARS' },
    ],
    onSubmit: async (v) => {
      if (v.logoFile) { const r = await uploadImage(v.logoFile); v.logo = r.url; }
      if (v.coverFile) { const r = await uploadImage(v.coverFile); v.cover = r.url; }
      await tenantApi.update({
        name: v.name,
        settings: { currency: v.currency },
        branding: { description: v.description, logo: v.logo || '', cover: v.cover || '', colors: { accent: v.accent }, cuisine: v.cuisine },
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
    <p class="help">Organizá tu marketing. Tocá <strong>"✨ Sugerir con IA"</strong> y la IA te propone 4 publicaciones de Instagram (texto + hashtags + idea de foto) según tu menú; con "Usar como campaña" la guardás. O creá una manual con <strong>"+ Nueva campaña"</strong>.</p>
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
