import { api, me, tenantApi, productsApi, ordersApi, expensesApi, expenseSheetsApi, campaignsApi, uploadExpenseOcr, importProducts, uploadImage, productFromPhoto, importProductsFromWhatsApp, ordersStreamUrl, adminApi, getToken, messagesApi, eventsApi, eventItemsFromPhoto } from './api.js';
import { money, num, esc, formModal, confirmDialog, infoModal, toast, onInterval, clearTimers, onCleanup, playPing, pushNotify, requestNotifyPermission, soundEnabled, setSoundEnabled, getTone, setTone, getAlarmLevel, setAlarmLevel, getComanda, setComanda, printComanda, connectThermal, testComanda } from './ui.js';
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
let _bizName = null; // nombre del comercio, cacheado para el ticket de comanda
let _ordersArchived = false; // ¿la vista de Pedidos muestra los archivados?
const waNumber = (phone) => String(phone || '').replace(/\D/g, '');
const waReply = (o) => `Hola ${o.customer?.name || ''}! Te escribimos por tu pedido #${o.code}.`;

const loading = (host) => { host.innerHTML = '<div class="spinner">Cargando…</div>'; };

/* ===================== RESUMEN ===================== */
const PERIODS = { 30: 'Últimos 30 días', 90: 'Últimos 90 días', 365: 'Último año', all: 'Desde siempre' };
export async function renderResumen(host, opts = {}) {
  const sel = PERIODS[opts.days] ? String(opts.days) : '30';
  // Rango explícito: el backend filtra ventas y gastos por estas fechas.
  const to = new Date();
  const from = sel === 'all' ? new Date('2000-01-01') : new Date(Date.now() - Number(sel) * 24 * 60 * 60 * 1000);
  const q = `?from=${from.toISOString()}&to=${to.toISOString()}`;
  host.innerHTML = `
    <div class="view-head"><h1>Resumen</h1>
      <select class="input" id="period" style="width:auto;min-height:38px;padding:6px 10px">
        ${Object.entries(PERIODS).map(([d, l]) => `<option value="${d}" ${d === sel ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <p class="help">Vista general de tu negocio: ventas cobradas, pedidos, gastos y ganancia del período elegido (arriba a la derecha). Ojo: acá solo se ven los gastos <strong>con fecha dentro del período</strong>; si cargaste uno con fecha vieja, ampliá el período o corregí su fecha en Gastos.</p>
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

  host.querySelector('#period').addEventListener('change', (e) => renderResumen(host, { days: e.target.value }));

  const [s, sales, exp, prod] = await Promise.allSettled([api.summary(q), api.sales(q), api.expenses(q), api.products(q)]);
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
        <button class="btn" id="import-wa">Importar de WhatsApp</button>
        <button class="btn" id="ext-wa">🧩 Extensión WhatsApp</button>
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

  host.querySelector('#ext-wa').addEventListener('click', async () => {
    let meta = { version: '', file: '' };
    try { meta = await fetch('/downloads/ext-version.json', { cache: 'no-store' }).then((r) => r.json()); } catch {}
    const ov = infoModal({
      title: 'Importar desde WhatsApp Web (extensión Chrome)',
      html: `
        <p class="muted" style="margin:0 0 12px">Extensión de Chrome que lee el catálogo abierto en WhatsApp Web e importa los productos (precio, descripción, categoría e imagen) <strong>directo a tu cuenta</strong>, sin descargar archivos.</p>
        <a class="btn btn-accent" href="${esc(meta.file || '#')}" download style="display:inline-flex;margin:0 0 14px">⬇ Descargar extensión${meta.version ? ` v${esc(meta.version)}` : ''}</a>
        <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.75">
          <li>Descomprimí el <strong>.zip</strong> en una carpeta.</li>
          <li>Entrá a <span class="mono">chrome://extensions</span> y activá <strong>Modo de desarrollador</strong>.</li>
          <li><strong>Cargar descomprimida</strong> → elegí la carpeta.</li>
          <li><strong>Recargá esta pestaña</strong> de RestaurApp (F5) después de instalar, para que la extensión tome tu sesión.</li>
          <li>Abrí <strong>web.whatsapp.com</strong> con el catálogo abierto → botón <strong>🍽️ RestaurApp</strong> → <em>Leer visible</em> o <em>Modo clic</em> → <strong>Importar a RestaurApp</strong>.</li>
        </ol>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <p class="muted" style="font-size:12px;margin:0 0 8px">¿La extensión dice "No encuentro tu sesión"? Copiá tu token y pegalo en la extensión (link "Pegar token manual").</p>
          <button class="btn btn-sm" id="ra-copy-token">🔑 Copiar token para la extensión</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:12px">Los productos aparecen acá en el Menú. Si alguno no se detecta, usá "Modo clic". Recordá tu límite de productos según el plan.</p>`,
    });
    ov.card.querySelector('#ra-copy-token')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(getToken() || ''); toast('Token copiado — pegalo en la extensión', 'success'); }
      catch { toast('No se pudo copiar', 'error'); }
    });
  });

  host.querySelector('#import-wa').addEventListener('click', () => {
    if (!tenant.integrations?.whatsapp?.connected) {
      toast('Primero conectá WhatsApp Business en Ajustes → Integraciones', 'info');
      return;
    }
    formModal({
      title: 'Importar catálogo de WhatsApp',
      submitLabel: 'Importar',
      fields: [
        { name: 'catalogId', label: 'ID del catálogo', required: true, placeholder: 'Ej. 1234567890', help: 'Lo encontrás en Meta Commerce Manager → tu catálogo → Configuración → "ID del catálogo".' },
      ],
      onSubmit: async (v) => {
        toast('Importando catálogo de WhatsApp…', 'info');
        const r = await importProductsFromWhatsApp(v.catalogId);
        toast(r.imported ? `${r.imported} productos importados` : 'No se encontraron productos en el catálogo', r.imported ? 'success' : 'info');
        reload();
      },
    });
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
  // Solo en carga real (no en refresco silencioso) reiniciamos timers + stream para no acumular.
  if (!opts.silent) clearTimers();
  if (!opts.silent) loading(host);
  const archived = _ordersArchived;
  let items;
  try {
    items = await ordersApi.list(archived ? '?archived=1' : '');
  } catch (e) {
    if (!opts.silent) {
      host.innerHTML = `<div class="empty">${esc(e.message)} — reintentando…</div>`;
      scheduleOrders(host); startOrderStream(host); // se recupera solo en el próximo ciclo
    }
    return;
  }
  const reload = () => renderPedidos(host);
  if (_bizName === null) { try { _bizName = (await tenantApi.get()).name || ''; } catch { _bizName = ''; } }

  // Aviso de pedidos nuevos (sonido + notificación), solo en la vista activa.
  if (archived) {
    // no tocar _seenOrderIds ni alertas en el historial
  } else if (_seenOrderIds === null) {
    _seenOrderIds = new Set(items.map((o) => o._id));
  } else {
    const fresh = items.filter((o) => o.status === 'new' && !_seenOrderIds.has(o._id));
    if (fresh.length) {
      playPing();
      const o = fresh[0];
      const extra = fresh.length > 1 ? ` (+${fresh.length - 1} más)` : '';
      pushNotify('Nuevo pedido', `#${o.code} · ${o.customer?.name || 'Cliente'} · ${money.format(o.total)}${extra}`);
      toast(`🔔 Nuevo pedido #${o.code}${extra}`, 'success');
      const c = getComanda(); // auto-impresión de comanda si está activada
      if (c.on && c.auto) for (const f of fresh) printComanda(f, _bizName).catch(() => {});
    }
    for (const o of items) _seenOrderIds.add(o._id);
  }

  host.innerHTML = `
    <div class="view-head"><h1>Pedidos${archived ? ' · archivados' : ''}</h1><div style="display:flex;gap:10px;align-items:center">${archived ? '' : '<span class="live">● En vivo</span>'}<button class="btn btn-sm" id="toggle-arch">${archived ? '← Activos' : 'Archivados'}</button><button class="btn btn-sm" id="refresh">Actualizar</button></div></div>
    <p class="help">${archived ? 'Pedidos <strong>entregados o cancelados</strong> de hace más de 12 h. Siguen contando en tus ventas; acá podés reimprimir su comanda.' : 'Acá caen los pedidos al <strong>instante</strong> (en vivo; si se corta, refresca cada 25s). Avanzá el estado con el botón azul. Los <strong>entregados/cancelados se archivan solos a las 12 h</strong> (botón "Archivados").'}</p>
    ${!items.length ? `<div class="panel"><div class="empty">${archived ? 'No hay pedidos archivados todavía.' : 'No hay pedidos activos. Los pedidos de la landing, WhatsApp y delivery aparecen acá.'}</div></div>`
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
          <button class="btn btn-sm" data-print="${o._id}" title="Imprimir comanda">🖨️</button>
          ${o.customer?.phone ? `<a class="btn btn-sm" href="https://wa.me/${waNumber(o.customer.phone)}?text=${encodeURIComponent(waReply(o))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
          ${next ? `<button class="btn btn-sm btn-accent" data-next="${o._id}" data-to="${next}">${ORDER_LABEL[next]} ▸</button>` : ''}
          ${!paid && o.status !== 'cancelled' ? `<button class="btn btn-sm" data-pay="${o._id}">Cobrado</button>` : ''}
          ${o.status !== 'cancelled' && o.status !== 'delivered' ? `<button class="btn btn-sm btn-danger" data-cancel="${o._id}">Cancelar</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`}`;

  host.querySelector('#refresh').addEventListener('click', reload);
  host.querySelector('#toggle-arch')?.addEventListener('click', () => { _ordersArchived = !_ordersArchived; renderPedidos(host); });
  host.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    await ordersApi.setStatus(b.dataset.next, b.dataset.to); toast(`Pedido → ${ORDER_LABEL[b.dataset.to]}`, 'success'); reload();
  }));
  host.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
    await ordersApi.pay(b.dataset.pay); toast('Marcado como cobrado · se suma a ventas', 'success'); reload();
  }));
  host.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog('¿Cancelar este pedido?')) { await ordersApi.setStatus(b.dataset.cancel, 'cancelled'); toast('Pedido cancelado', 'success'); reload(); }
  }));
  host.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', async () => {
    const o = items.find((x) => x._id === b.dataset.print);
    try { await printComanda(o, _bizName); }
    catch (ex) { toast(ex.message || 'No se pudo imprimir', 'error'); }
  }));

  if (!opts.silent) { scheduleOrders(host); startOrderStream(host); }
}

// Polling de respaldo: refresco silencioso por si el stream SSE se cae. Un solo timer.
function scheduleOrders(host) {
  onInterval(() => {
    if (document.visibilityState === 'visible' && document.body.contains(host)) renderPedidos(host, { silent: true });
  }, 25000);
}

// Stream SSE: cuando entra/cambia un pedido, el server avisa y refrescamos al instante.
function startOrderStream(host) {
  let es;
  try { es = new EventSource(ordersStreamUrl()); } catch { return; }
  es.addEventListener('change', () => {
    if (document.visibilityState !== 'hidden' && document.body.contains(host)) renderPedidos(host, { silent: true });
  });
  onCleanup(() => { try { es.close(); } catch {} }); // el router lo cierra al cambiar de vista
}

/* ===================== GASTOS ===================== */
let _gtab = 'generales'; // solapa activa: generales | eventos
let _expSort = { field: 'date', dir: -1 }; // orden de la tabla de gastos
const EXP_VIEW_KEY = 'restaurapp.expview';
const getExpView = () => { try { return localStorage.getItem(EXP_VIEW_KEY) || 'cards'; } catch { return 'cards'; } };
const setExpView = (v) => { try { localStorage.setItem(EXP_VIEW_KEY, v); } catch {} };
const EXP_SHEET_KEY = 'restaurapp.expsheet'; // hoja/pestaña activa de gastos ('general' o un id)
const getExpSheet = () => { try { return localStorage.getItem(EXP_SHEET_KEY) || 'general'; } catch { return 'general'; } };
const setExpSheet = (v) => { try { localStorage.setItem(EXP_SHEET_KEY, v); } catch {} };
export async function renderGastos(host) {
  host.innerHTML = `
    <div class="view-head"><h1>Gastos</h1>
      <div class="seg">
        <button class="seg-btn ${_gtab === 'generales' ? 'on' : ''}" data-gt="generales">Generales</button>
        <button class="seg-btn ${_gtab === 'eventos' ? 'on' : ''}" data-gt="eventos">Por evento</button>
      </div>
    </div>
    <div id="gbody"></div>`;
  host.querySelectorAll('[data-gt]').forEach((b) => b.addEventListener('click', () => { _gtab = b.dataset.gt; renderGastos(host); }));
  const body = host.querySelector('#gbody');
  if (_gtab === 'eventos') renderEventos(body); else renderGenerales(body);
}

async function renderGenerales(host) {
  host.innerHTML = '<div class="spinner">Cargando…</div>';
  let items; let sheets = []; let tenant = {};
  const active = getExpSheet(); // hoja/pestaña activa ('general' o un id)
  try {
    [items, sheets, tenant] = await Promise.all([
      expensesApi.list(`?sheet=${active}`),
      expenseSheetsApi.list(),
      tenantApi.get(),
    ]);
  } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const columns = tenant?.settings?.expenseColumns || []; // columnas propias [{key,label,type}]
  // Resumen (sumarización) de la hoja activa: total, cantidad y desglose por categoría.
  const total = items.reduce((a, x) => a + (Number(x.total) || 0), 0);
  const byCat = {};
  items.forEach((x) => { const k = x.category || 'other'; byCat[k] = (byCat[k] || 0) + (Number(x.total) || 0); });
  const sheetName = active === 'general' ? 'General' : (sheets.find((s) => s._id === active)?.name || 'Hoja');
  // Recalcula el resumen (total/cantidad/categorías) en vivo, sin recargar toda la vista.
  const updateSummary = () => {
    const t = items.reduce((a, x) => a + (Number(x.total) || 0), 0);
    const amtEl = host.querySelector('.exp-summary .sum-amt'); if (amtEl) amtEl.textContent = money.format(t);
    const cntEl = host.querySelector('.exp-summary .sum-count'); if (cntEl) cntEl.textContent = `${items.length} gasto${items.length === 1 ? '' : 's'}`;
    const bc = {}; items.forEach((x) => { const k = x.category || 'other'; bc[k] = (bc[k] || 0) + (Number(x.total) || 0); });
    const catEl = host.querySelector('.exp-summary .sum-cats'); if (catEl) catEl.innerHTML = Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="sum-cat">${esc(CAT_ES[k] || k)} <b>${money.format(v)}</b></span>`).join('');
  };
  // si la hoja activa se borró en otro lado, volver a General
  if (active !== 'general' && !sheets.some((s) => s._id === active)) { setExpSheet('general'); renderGenerales(host); return; }
  const reload = () => renderGenerales(host);
  const sheetIdForNew = () => (active === 'general' ? undefined : active); // hoja donde caen los gastos nuevos

  const openForm = (x) => formModal({
    title: x ? 'Editar gasto' : 'Cargar gasto',
    submitLabel: 'Guardar',
    values: x
      ? { product: x.items?.[0]?.desc || '', vendor: x.vendor, total: x.total, note: x.note || '', category: x.category || 'other', date: new Date(x.date).toISOString().slice(0, 10) }
      : { date: new Date().toISOString().slice(0, 10), category: 'supplies' },
    fields: [
      { name: 'date', label: 'Día', type: 'date' },
      { name: 'product', label: 'Producto', placeholder: 'Ej. Harina 0000' },
      { name: 'vendor', label: 'Proveedor', placeholder: 'Ej. jumbo, dia, verdulería' },
      { name: 'total', label: 'Precio', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'note', label: 'Cantidad', placeholder: 'Ej. 1kg, 4 bandejas' },
      { name: 'category', label: 'Categoría', type: 'select', options: EXP_CATS },
    ],
    onSubmit: async (v) => {
      const body = {
        vendor: v.vendor || undefined,
        total: v.total,
        note: v.note || undefined,
        category: v.category,
        date: v.date || undefined,
        items: v.product ? [{ desc: v.product, amount: v.total }] : undefined,
      };
      if (x) {
        if (x.ocrStatus === 'review') body.ocrStatus = 'done'; // editar confirma el OCR
        await expensesApi.update(x._id, body); toast('Gasto actualizado', 'success');
      } else { await expensesApi.create({ ...body, sheetId: sheetIdForNew() }); toast('Gasto cargado', 'success'); }
      reload();
    },
  });

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <button class="btn" id="export">Descargar CSV</button>
      <button class="btn" id="import">Importar CSV</button>
      <button class="btn" id="ocr">📷 Cargar por foto</button>
      <button class="btn btn-accent" id="add">+ Cargar gasto</button>
      <input type="file" accept="image/*" id="ocr-file" hidden />
      <input type="file" accept=".csv,text/csv" id="csv-file" hidden />
    </div>
    <p class="help">Gastos del día a día (no atados a un evento). Agrupalos en hojas (pestañas), como en Excel. Cargá manual, por foto, o importá un CSV.</p>
    <div class="sheet-tabs">
      <button class="sheet-tab${active === 'general' ? ' on' : ''}" data-sheet="general">General</button>
      ${sheets.map((s) => `<button class="sheet-tab${active === s._id ? ' on' : ''}" data-sheet="${s._id}" title="Doble clic para renombrar">${esc(s.name)}<span class="sheet-x" data-delsheet="${s._id}" title="Eliminar hoja">✕</span></button>`).join('')}
      <button class="sheet-add" id="sheet-add" title="Nueva hoja">＋ hoja</button>
    </div>
    <div class="seg" style="margin-bottom:10px">
      <button class="seg-btn" data-view="cards">▤ Tarjetas</button>
      <button class="seg-btn" data-view="table">▦ Planilla</button>
      <button class="seg-btn" data-view="excel">⊞ Excel (pegar)</button>
    </div>
    <div class="exp-summary">
      <div class="sum-box"><span class="sum-lbl">Total · ${esc(sheetName)}</span><b class="sum-amt">${money.format(total)}</b><span class="sum-count">${items.length} gasto${items.length === 1 ? '' : 's'}</span></div>
      <div class="sum-cats">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="sum-cat">${esc(CAT_ES[k] || k)} <b>${money.format(v)}</b></span>`).join('')}</div>
    </div>
    <div id="genlist"></div>`;

  // Pestañas (hojas): cambiar, crear, renombrar, eliminar
  host.querySelectorAll('.sheet-tab').forEach((b) => {
    b.addEventListener('click', (ev) => {
      if (ev.target.closest('.sheet-x')) return; // el ✕ se maneja aparte
      setExpSheet(b.dataset.sheet); reload();
    });
    if (b.dataset.sheet !== 'general') {
      b.addEventListener('dblclick', async () => {
        const name = window.prompt('Nombre de la hoja:', b.textContent.replace('✕', '').trim());
        if (name && name.trim()) { await expenseSheetsApi.update(b.dataset.sheet, { name: name.trim() }); toast('Hoja renombrada', 'success'); reload(); }
      });
    }
  });
  host.querySelectorAll('[data-delsheet]').forEach((x) => x.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (await confirmDialog('¿Eliminar esta hoja? Los gastos no se borran: vuelven a "General".')) {
      await expenseSheetsApi.remove(x.dataset.delsheet);
      if (active === x.dataset.delsheet) setExpSheet('general');
      toast('Hoja eliminada', 'success'); reload();
    }
  }));
  host.querySelector('#sheet-add').addEventListener('click', async () => {
    const name = window.prompt('Nombre de la nueva hoja (ej. Insumos, Catering, Junio):');
    if (name && name.trim()) {
      const s = await expenseSheetsApi.create(name.trim());
      setExpSheet(s._id); toast('Hoja creada', 'success'); reload();
    }
  });

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
      try {
        await expensesApi.create({
          vendor: r.vendor || undefined,
          note: r.note || undefined,
          total: r.total,
          category: EXP_VALID.has(r.category) ? r.category : undefined,
          date: r.date || undefined,
          sheetId: sheetIdForNew(),
          items: r.product ? [{ desc: r.product, amount: r.total }] : undefined,
        });
        ok += 1;
      } catch {}
    }
    toast(`${ok} gastos importados`, 'success'); reload();
  });

  // Vista (tarjetas / tabla editable) + orden por columna
  const prodOf = (x) => x.items?.[0]?.desc || x.vendor || 'Gasto';
  const fmtDay = (d) => new Date(d).toLocaleDateString('es-AR');
  const ymd = (d) => new Date(d).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const catOpts = (val) => EXP_CATS.map((o) => `<option value="${o.value}" ${o.value === (val || 'supplies') ? 'selected' : ''}>${o.label}</option>`).join('');
  let newRows = []; // filas de carga rápida aún sin guardar
  const lastCtx = () => { // proveedor/día/categoría a "arrastrar" en la próxima fila
    const r = newRows[newRows.length - 1];
    if (r) return { vendor: r.vendor, date: r.date, category: r.category };
    const x = items[0];
    return { vendor: x?.vendor || '', date: today, category: x?.category || 'supplies' };
  };
  const addNewRow = () => { const c = lastCtx(); newRows.push({ date: c.date || today, product: '', vendor: c.vendor || '', note: '', total: '', category: c.category || 'supplies' }); };

  const sortedItems = () => {
    const { field: f, dir } = _expSort;
    return [...items].sort((a, b) => {
      let va; let vb;
      if (f === 'total') { va = a.total || 0; vb = b.total || 0; }
      else if (f === 'product') { va = prodOf(a).toLowerCase(); vb = prodOf(b).toLowerCase(); }
      else if (f === 'vendor') { va = (a.vendor || '').toLowerCase(); vb = (b.vendor || '').toLowerCase(); }
      else { va = new Date(a.date).getTime(); vb = new Date(b.date).getTime(); }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  };

  // Guarda inline una fila existente (PATCH) leyendo sus celdas
  async function saveRow(tr) {
    const id = tr.dataset.id;
    const g = (f) => tr.querySelector(`[data-f="${f}"]`)?.value ?? '';
    const total = Number(g('total'));
    if (!Number.isFinite(total) || total < 0) { toast('Precio inválido', 'error'); return; }
    const product = g('product').trim();
    const body = {
      vendor: g('vendor').trim() || undefined,
      note: g('note').trim() || undefined,
      total,
      category: g('category'),
      date: g('date') || undefined,
      items: product ? [{ desc: product, amount: total }] : [],
    };
    const x = items.find((e) => e._id === id);
    if (x && x.ocrStatus === 'review') body.ocrStatus = 'done';
    try {
      const updated = await expensesApi.update(id, body);
      if (x) Object.assign(x, updated); // mantener `items` en sync sin recargar
      tr.classList.add('saved'); setTimeout(() => tr.classList.remove('saved'), 700);
    } catch (e) { toast(e.message || 'No se pudo guardar', 'error'); }
  }

  const slugCol = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  // Planilla profesional tipo Excel (Jspreadsheet CE). Edición de celdas, navegación con teclado,
  // copiar/pegar desde Excel, columnas que se arrastran/redimensionan, + columnas propias. Se guarda solo.
  function mountExcelGrid(box) {
    box.innerHTML = `
      <div class="xls-tools">
        <button class="btn btn-sm" id="grid-add">+ fila</button>
        <button class="btn btn-sm btn-danger" id="grid-del">🗑 Borrar fila</button>
        <button class="btn btn-sm" id="col-add">＋ columna</button>
        ${columns.map((c) => `<span class="col-chip">${esc(c.label)}<span class="col-x" data-delcol="${c.key}" title="Eliminar columna">✕</span></span>`).join('')}
        <span class="save-status" id="save-status" data-state="ok">✓ Guardado</span>
        <span class="help">Tocá una celda y escribí; Tab/Enter para moverte. Para borrar: seleccioná la fila y "🗑 Borrar fila".</span>
      </div>
      <div id="xls-grid"></div>`;
    const el = box.querySelector('#xls-grid');
    const statusEl = box.querySelector('#save-status');
    let statusTimer = null;
    const setStatus = (state) => { // ok | saving | error
      if (!statusEl) return;
      clearTimeout(statusTimer);
      statusEl.dataset.state = state;
      statusEl.textContent = state === 'saving' ? '⏳ Guardando…' : state === 'error' ? '⚠ No se pudo guardar' : '✓ Guardado';
      if (state === 'ok') { statusEl.textContent = '✓ Guardado ahora'; statusTimer = setTimeout(() => { statusEl.textContent = '✓ Guardado'; }, 2000); }
    };
    let selRow = null; // fila seleccionada (para "Borrar fila")
    const vendors = [...new Set(items.map((x) => x.vendor).filter(Boolean))];
    const catSource = EXP_CATS.map((c) => ({ id: c.value, name: c.label }));
    const blankRow = () => ['', today, '', '', '', '', 'supplies', ...columns.map(() => '')];
    const rowOf = (x) => [
      x._id || '',
      x.date ? new Date(x.date).toISOString().slice(0, 10) : today,
      x.items?.[0]?.desc || '',
      x.vendor || '',
      x.note || '',
      (x.total ?? '') === '' ? '' : Number(x.total),
      x.category || 'supplies',
      ...columns.map((c) => (x.custom?.[c.key] ?? '')),
    ];
    const data = sortedItems().map(rowOf);
    let grid; let syncing = false;

    const parseNum = (v) => { // tolera "1.234,56" (es-AR) y "1234.56"
      if (typeof v === 'number') return v;
      let s = String(v ?? '').trim();
      if (!s) return NaN;
      if (/,\d{1,2}$/.test(s) || (s.includes('.') && s.includes(','))) s = s.replace(/\./g, '').replace(',', '.');
      return Number(s.replace(/[^0-9.\-]/g, ''));
    };
    const saveRowAt = async (y) => {
      const r = grid.getRowData(y);
      const id = r[0];
      const total = parseNum(r[5]);
      const product = String(r[2] || '').trim();
      if (!Number.isFinite(total) || total <= 0) return; // fila incompleta: aún no guardamos
      const body = {
        vendor: String(r[3] || '').trim() || undefined,
        note: String(r[4] || '').trim() || undefined,
        total,
        category: EXP_VALID.has(r[6]) ? r[6] : 'supplies',
        date: r[1] || undefined,
        items: product ? [{ desc: product, amount: total }] : [],
      };
      if (columns.length) { // columnas propias → body.custom
        const custom = {};
        columns.forEach((c, i) => { const v = r[7 + i]; if (v !== '' && v != null) custom[c.key] = v; });
        body.custom = custom;
      }
      setStatus('saving');
      try {
        if (id) {
          const up = await expensesApi.update(id, body);
          const x = items.find((e) => e._id === id); if (x) Object.assign(x, up);
        } else {
          const created = await expensesApi.create({ ...body, sheetId: sheetIdForNew() });
          items.push(created);
          syncing = true;
          try { grid.setValueFromCoords(0, y, created._id, true); } catch {} // guardar el id en la fila (col oculta)
          syncing = false;
        }
        updateSummary();
        setStatus('ok');
        try { const tr = el.querySelector(`tbody tr:nth-child(${y + 1})`); if (tr) { tr.classList.add('row-saved'); setTimeout(() => tr.classList.remove('row-saved'), 900); } } catch {}
      } catch (e) { syncing = false; setStatus('error'); toast(e.message || 'No se pudo guardar', 'error'); }
    };

    grid = window.jspreadsheet(el, {
      data: data.length ? data : [blankRow()],
      tableOverflow: true,
      tableHeight: '62vh',
      columnDrag: true,
      allowInsertColumn: false,
      allowManualInsertColumn: false,
      allowDeleteColumn: false,
      columns: [
        { type: 'hidden' },
        { type: 'calendar', title: 'Día', width: 110, options: { format: 'YYYY-MM-DD' } },
        { type: 'text', title: 'Producto', width: 230 },
        { type: 'autocomplete', title: 'Proveedor', width: 160, source: vendors },
        { type: 'text', title: 'Cantidad', width: 100 },
        { type: 'numeric', title: 'Precio', width: 120 },
        { type: 'dropdown', title: 'Categoría', width: 150, source: catSource },
        ...columns.map((c) => ({ type: 'text', title: c.label, width: 150 })),
      ],
      onselection: (instance, x1, y1) => { selRow = Number(y1); },
      onchange: (instance, cell, colX, rowY) => { if (!syncing) saveRowAt(Number(rowY)); },
      ondeleterow: async (instance, rowNumber, numOfRows, rowDOM, rowData) => {
        for (const vals of (rowData || [])) {
          const id = Array.isArray(vals) ? vals[0] : null;
          if (id) { try { await expensesApi.remove(id); items = items.filter((e) => e._id !== id); } catch {} }
        }
        updateSummary();
      },
    });
    box.querySelector('#grid-add').addEventListener('click', () => {
      // insertRow() agrega una fila vacía al final (forma segura del API); el día/categoría
      // toman sus valores por defecto en el servidor al guardar.
      const n = grid.getData().length;
      grid.insertRow();
      try { syncing = true; grid.setValueFromCoords(1, n, today, true); syncing = false; } catch { syncing = false; } // prefijar el Día
    });
    box.querySelector('#grid-del').addEventListener('click', async () => {
      if (selRow == null) { toast('Tocá una celda de la fila que querés borrar', 'info'); return; }
      const y = selRow;
      const id = grid.getRowData(y)?.[0];
      if (!(await confirmDialog('¿Borrar esta fila?'))) return;
      setStatus('saving');
      try {
        if (id) { await expensesApi.remove(id); items = items.filter((e) => e._id !== id); }
        syncing = true; grid.deleteRow(y); syncing = false;
        selRow = null; updateSummary(); setStatus('ok');
      } catch (e) { syncing = false; setStatus('error'); toast(e.message || 'No se pudo borrar', 'error'); }
    });
    box.querySelector('#col-add').addEventListener('click', async () => {
      const label = window.prompt('Nombre de la columna (ej. N° factura, Forma de pago):');
      if (!label || !label.trim()) return;
      const key = slugCol(label) || `col_${Date.now()}`;
      if (columns.some((c) => c.key === key)) { toast('Ya existe una columna así', 'error'); return; }
      await tenantApi.update({ settings: { expenseColumns: [...columns, { key, label: label.trim(), type: 'text' }] } });
      toast('Columna agregada', 'success'); reload();
    });
    box.querySelectorAll('[data-delcol]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmDialog('¿Eliminar esta columna? Los datos ya cargados quedan guardados.')) {
        await tenantApi.update({ settings: { expenseColumns: columns.filter((c) => c.key !== b.dataset.delcol) } });
        toast('Columna eliminada', 'success'); reload();
      }
    }));
  }

  // Planilla con inputs NATIVOS: clic en la celda y escribís (sin doble clic), se guarda al
  // salir de la celda. Confiable en cualquier dispositivo, con columnas propias e indicador.
  function renderNativeGrid(box) {
    const parseNum = (val) => { if (typeof val === 'number') return val; let s = String(val ?? '').trim(); if (!s) return NaN; if (/,\d{1,2}$/.test(s) || (s.includes('.') && s.includes(','))) s = s.replace(/\./g, '').replace(',', '.'); return Number(s.replace(/[^0-9.\-]/g, '')); };
    const vendors = [...new Set(items.map((x) => x.vendor).filter(Boolean))];
    const arr = (f) => (_expSort.field === f ? (_expSort.dir < 0 ? ' ▾' : ' ▴') : '');
    const colHead = columns.map((c) => `<th>${esc(c.label)} <span class="col-x" data-delcol="${c.key}" title="Eliminar columna">✕</span></th>`).join('');
    const colCells = (cu) => columns.map((c) => `<td><input class="gc" data-f="c:${c.key}" value="${esc(cu?.[c.key] ?? '')}"></td>`).join('');
    const rowHtml = (x) => `<tr${x._id ? ` data-id="${x._id}"` : ''}>
      <td class="rownum"></td>
      <td data-l="Día"><input class="gc" type="date" data-f="date" value="${x.date ? ymd(x.date) : today}"></td>
      <td data-l="Producto"><input class="gc" data-f="product" value="${esc(x.items?.[0]?.desc || '')}" placeholder="Producto"></td>
      <td data-l="Proveedor"><input class="gc" data-f="vendor" list="exp-vendors" value="${esc(x.vendor || '')}" placeholder="Proveedor"></td>
      <td data-l="Cantidad"><input class="gc" data-f="note" value="${esc(x.note || '')}" placeholder="Cant."></td>
      <td data-l="Precio"><input class="gc num" type="number" inputmode="decimal" step="0.01" min="0" data-f="total" value="${x.total ?? ''}" placeholder="0"></td>
      <td data-l="Categoría"><select class="gc" data-f="category">${catOpts(x.category)}</select></td>
      ${colCells(x.custom)}
      <td class="xls-act"><button class="btn btn-sm btn-danger" data-delrow title="Borrar fila">✕</button></td>
    </tr>`;
    const blank = { _id: '', date: today, items: [], vendor: '', note: '', total: '', category: 'supplies', custom: {} };
    box.innerHTML = `
      <div class="xls-tools">
        <button class="btn btn-sm" id="add-row">+ fila</button>
        <button class="btn btn-sm" id="col-add">＋ columna</button>
        <span class="save-status" id="save-status" data-state="ok">✓ Guardado</span>
        <span class="help">Clic en una celda y escribí · <b>Enter</b> baja, <b>Tab</b> avanza · se guarda al salir de la celda.</span>
      </div>
      <div class="xls-wrap"><table class="xls"><thead><tr>
        <th class="rownum">#</th>
        <th data-sort="date">Día${arr('date')}</th>
        <th data-sort="product">Producto${arr('product')}</th>
        <th data-sort="vendor">Proveedor${arr('vendor')}</th>
        <th>Cantidad</th>
        <th data-sort="total" class="num">Precio${arr('total')}</th>
        <th>Categoría</th>${colHead}<th></th>
      </tr></thead>
      <tbody>${sortedItems().map(rowHtml).join('')}${rowHtml(blank)}</tbody>
      <tfoot><tr>
        <td class="rownum"></td>
        <td colspan="4" class="foot-label">Total</td>
        <td class="num foot-total" id="grid-total"></td>
        <td colspan="${2 + columns.length}"></td>
      </tr></tfoot>
      </table></div>
      <datalist id="exp-vendors">${vendors.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
    const refreshFoot = () => { const t = items.reduce((a, x) => a + (Number(x.total) || 0), 0); const el = box.querySelector('#grid-total'); if (el) el.textContent = money.format(t); };

    const statusEl = box.querySelector('#save-status'); let st;
    const setStatus = (s) => { if (!statusEl) return; clearTimeout(st); statusEl.dataset.state = s; statusEl.textContent = s === 'saving' ? '⏳ Guardando…' : s === 'error' ? '⚠ No se pudo guardar' : '✓ Guardado'; if (s === 'ok') { statusEl.textContent = '✓ Guardado ahora'; st = setTimeout(() => { statusEl.textContent = '✓ Guardado'; }, 2000); } };
    const readRow = (tr) => {
      const v = (f) => { const e = tr.querySelector(`[data-f="${f}"]`); return e ? e.value : ''; };
      const total = parseNum(v('total'));
      const product = v('product').trim();
      const custom = {}; columns.forEach((c) => { const val = String(v(`c:${c.key}`)).trim(); if (val) custom[c.key] = val; });
      const body = { vendor: v('vendor').trim() || undefined, note: v('note').trim() || undefined, total, category: v('category') || 'supplies', date: v('date') || undefined, items: product ? [{ desc: product, amount: total }] : [] };
      if (columns.length) body.custom = custom;
      return { body, total };
    };
    let wireRow;
    const saveTr = async (tr) => {
      const { body, total } = readRow(tr);
      if (!Number.isFinite(total) || total <= 0) return; // sin precio válido: todavía no guardamos
      const id = tr.dataset.id;
      setStatus('saving');
      try {
        if (id) {
          const up = await expensesApi.update(id, body);
          const x = items.find((e) => e._id === id); if (x) Object.assign(x, up);
        } else {
          const created = await expensesApi.create({ ...body, sheetId: sheetIdForNew() });
          items.push(created); tr.dataset.id = created._id;
          const tbody = tr.parentElement; // la fila se "consumió": dejar otra en blanco al final
          if (tr === tbody.lastElementChild) { tbody.insertAdjacentHTML('beforeend', rowHtml(blank)); wireRow(tbody.lastElementChild); }
        }
        updateSummary(); refreshFoot();
        tr.classList.add('saved'); setTimeout(() => tr.classList.remove('saved'), 900);
        setStatus('ok');
      } catch (e) { setStatus('error'); toast(e.message || 'No se pudo guardar', 'error'); }
    };
    const delTr = async (tr) => {
      const id = tr.dataset.id;
      if (!(await confirmDialog('¿Borrar esta fila?'))) return;
      setStatus('saving');
      try { if (id) { await expensesApi.remove(id); items = items.filter((e) => e._id !== id); } tr.remove(); updateSummary(); refreshFoot(); setStatus('ok'); }
      catch (e) { setStatus('error'); toast(e.message || 'No se pudo borrar', 'error'); }
    };
    wireRow = (tr) => {
      tr.querySelectorAll('.gc').forEach((el) => el.addEventListener('change', () => saveTr(tr)));
      const del = tr.querySelector('[data-delrow]'); if (del) del.addEventListener('click', () => delTr(tr));
    };
    box.querySelectorAll('tbody tr').forEach(wireRow);
    box.querySelector('#add-row').addEventListener('click', () => {
      const tbody = box.querySelector('tbody');
      tbody.insertAdjacentHTML('beforeend', rowHtml(blank));
      const tr = tbody.lastElementChild; wireRow(tr);
      const inp = tr.querySelector('[data-f="product"]'); if (inp) inp.focus();
    });
    box.querySelector('#col-add').addEventListener('click', async () => {
      const label = window.prompt('Nombre de la columna (ej. N° factura, Forma de pago):');
      if (!label || !label.trim()) return;
      const key = slugCol(label) || `col_${Date.now()}`;
      if (columns.some((c) => c.key === key)) { toast('Ya existe una columna así', 'error'); return; }
      await tenantApi.update({ settings: { expenseColumns: [...columns, { key, label: label.trim(), type: 'text' }] } });
      toast('Columna agregada', 'success'); reload();
    });
    box.querySelectorAll('[data-delcol]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmDialog('¿Eliminar esta columna? Los datos ya cargados quedan guardados.')) {
        await tenantApi.update({ settings: { expenseColumns: columns.filter((c) => c.key !== b.dataset.delcol) } });
        toast('Columna eliminada', 'success'); reload();
      }
    }));
    // Navegación con teclado tipo planilla: Enter baja a la misma columna de la fila de abajo.
    box.querySelector('table').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const inp = e.target; if (!inp.classList || !inp.classList.contains('gc')) return;
      const td = inp.closest('td'); const tr = inp.closest('tr'); const next = tr.nextElementSibling;
      if (!next) return;
      const idx = [...tr.children].indexOf(td);
      const cell = next.children[idx] && next.children[idx].querySelector('.gc');
      if (cell) { e.preventDefault(); cell.focus(); if (cell.select) cell.select(); }
    });
    // Ordenar por columna al hacer clic en el encabezado
    box.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (_expSort.field === f) _expSort.dir *= -1; else _expSort = { field: f, dir: f === 'date' ? -1 : 1 };
      renderNativeGrid(box);
    }));
    refreshFoot();
  }

  function paint() {
    const view = getExpView();
    host.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    const box = host.querySelector('#genlist');

    if (view === 'excel' && window.jspreadsheet) { mountExcelGrid(box); return; } // opción: planilla Excel (copiar/pegar)
    if (view === 'table') { renderNativeGrid(box); return; } // planilla nativa (default, confiable)
    if (view === 'oldtable') {
      if (!newRows.length) addNewRow();
      const arr = (f) => (_expSort.field === f ? (_expSort.dir < 0 ? ' ▾' : ' ▴') : '');
      const list = sortedItems();
      const vendors = [...new Set(items.map((x) => x.vendor).filter(Boolean))];
      const existRows = list.map((x) => `<tr data-id="${x._id}">
          <td><input class="xc" type="date" data-f="date" value="${ymd(x.date)}"></td>
          <td><input class="xc" data-f="product" value="${esc(x.items?.[0]?.desc || '')}" placeholder="Producto">${x.ocrStatus === 'review' ? '<span class="badge badge-warn">OCR</span>' : ''}</td>
          <td><input class="xc" data-f="vendor" list="exp-vendors" value="${esc(x.vendor || '')}" placeholder="Proveedor"></td>
          <td><input class="xc" data-f="note" value="${esc(x.note || '')}" placeholder="Cant."></td>
          <td><input class="xc num" type="number" step="0.01" min="0" data-f="total" value="${x.total}"></td>
          <td><select class="xc" data-f="category">${catOpts(x.category)}</select></td>
          <td class="xls-act"><button class="btn btn-sm btn-danger" data-del="${x._id}" title="Eliminar">✕</button></td>
        </tr>`).join('');
      const newRowsHtml = newRows.map((r, i) => `<tr class="new-row" data-new="${i}">
          <td><input class="xn" type="date" data-f="date" value="${esc(r.date || today)}"></td>
          <td><input class="xn" data-f="product" value="${esc(r.product)}" placeholder="Producto"></td>
          <td><input class="xn" data-f="vendor" list="exp-vendors" value="${esc(r.vendor)}" placeholder="Proveedor"></td>
          <td><input class="xn" data-f="note" value="${esc(r.note)}" placeholder="Cant."></td>
          <td><input class="xn num" type="number" step="0.01" min="0" data-f="total" value="${esc(r.total)}" placeholder="0"></td>
          <td><select class="xn" data-f="category">${catOpts(r.category)}</select></td>
          <td class="xls-act"><button class="btn btn-sm" data-rmnew="${i}" title="Quitar fila">−</button></td>
        </tr>`).join('');
      box.innerHTML = `<div class="xls-wrap"><table class="xls">
        <thead><tr>
          <th data-sort="date">Día${arr('date')}</th>
          <th data-sort="product">Producto${arr('product')}</th>
          <th data-sort="vendor">Proveedor${arr('vendor')}</th>
          <th>Cantidad</th>
          <th data-sort="total" class="num">Precio${arr('total')}</th>
          <th>Categoría</th>
          <th></th>
        </tr></thead>
        <tbody>${existRows}</tbody>
        <tbody class="xls-new">${newRowsHtml}</tbody>
      </table></div>
      <datalist id="exp-vendors">${vendors.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <div class="xls-foot">
        <button class="btn btn-sm" id="add-row">+ fila</button>
        <span class="help">El proveedor y el día se copian de la fila anterior. Editá una celda de arriba y se guarda sola.</span>
        <button class="btn btn-accent" id="save-new">Guardar filas nuevas</button>
      </div>`;

      box.querySelectorAll('tbody:not(.xls-new) .xc').forEach((el) => el.addEventListener('change', () => saveRow(el.closest('tr'))));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (await confirmDialog('¿Eliminar este gasto?')) { await expensesApi.remove(b.dataset.del); items = items.filter((x) => x._id !== b.dataset.del); toast('Gasto eliminado', 'success'); paint(); }
      }));
      box.querySelectorAll('.xls-new .xn').forEach((el) => el.addEventListener('input', () => {
        const i = Number(el.closest('tr').dataset.new);
        if (newRows[i]) newRows[i][el.dataset.f] = el.value;
      }));
      box.querySelectorAll('[data-rmnew]').forEach((b) => b.addEventListener('click', () => { newRows.splice(Number(b.dataset.rmnew), 1); if (!newRows.length) addNewRow(); paint(); }));
      box.querySelector('#add-row').addEventListener('click', () => { addNewRow(); paint(); const inp = box.querySelector('.xls-new tr:last-child [data-f="product"]'); if (inp) inp.focus(); });
      box.querySelector('#save-new').addEventListener('click', async () => {
        const toSave = newRows.filter((r) => Number(r.total) > 0);
        if (!toSave.length) { toast('Cargá al menos una fila con precio', 'error'); return; }
        toast(`Guardando ${toSave.length}…`, 'info');
        try {
          await expensesApi.bulk(toSave.map((r) => ({ product: r.product || undefined, vendor: r.vendor || undefined, note: r.note || undefined, total: Number(r.total), category: EXP_VALID.has(r.category) ? r.category : 'supplies', date: r.date || undefined })), sheetIdForNew());
          toast(`${toSave.length} gastos guardados`, 'success');
          newRows = []; reload();
        } catch (e) { toast(e.message || 'No se pudo guardar', 'error'); }
      });
      box.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
        const f = th.dataset.sort;
        if (_expSort.field === f) _expSort.dir *= -1; else _expSort = { field: f, dir: f === 'date' ? -1 : 1 };
        paint();
      }));
      return;
    }

    // Vista tarjetas (solo lectura)
    const list = sortedItems();
    if (!list.length) { box.innerHTML = '<div class="panel"><div class="empty">Sin gastos cargados.</div></div>'; return; }
    box.innerHTML = `<div class="list">${list.map((x) => {
      const sub = [x.vendor && x.items?.[0]?.desc ? esc(x.vendor) : '', x.note ? esc(x.note) : '', esc(CAT_ES[x.category] || x.category || 'Otros'), fmtDay(x.date)].filter(Boolean).join(' · ');
      return `<div class="list-item"><div class="li-main"><div class="li-title">${esc(prodOf(x))} ${x.ocrStatus === 'review' ? '<span class="badge badge-warn">Revisar (OCR)</span>' : ''}</div><div class="li-sub">${sub}</div></div><div class="li-amt">${money.format(x.total)}</div><div class="li-actions"><button class="btn btn-sm" data-edit="${x._id}">Editar</button><button class="btn btn-sm btn-danger" data-del="${x._id}">Eliminar</button></div></div>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(items.find((x) => x._id === b.dataset.edit))));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmDialog('¿Eliminar este gasto?')) { await expensesApi.remove(b.dataset.del); toast('Gasto eliminado', 'success'); reload(); }
    }));
  }
  host.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { setExpView(b.dataset.view); paint(); }));
  paint();
}

/* ---------- Gastos por evento ---------- */
function openEventForm(ev, reload) {
  formModal({
    title: ev ? 'Editar evento' : 'Nuevo evento',
    submitLabel: 'Guardar',
    values: ev ? { name: ev.name, date: new Date(ev.date).toISOString().slice(0, 10), pax: ev.pax, revenue: ev.revenue, description: ev.description } : { date: new Date().toISOString().slice(0, 10) },
    fields: [
      { name: 'name', label: 'Nombre del evento', required: true, placeholder: 'Ej. Paola y Darío' },
      { name: 'date', label: 'Fecha del evento', type: 'date' },
      { name: 'pax', label: 'PAX (personas)', type: 'number', min: 0 },
      { name: 'revenue', label: 'Monto cobrado', type: 'number', step: '0.01', min: 0, help: 'Lo que le cobrás al cliente (para el margen)' },
      { name: 'description', label: 'Descripción', placeholder: 'Ej. Día del Padre' },
    ],
    onSubmit: async (v) => {
      if (ev) await eventsApi.update(ev.id, v); else await eventsApi.create(v);
      toast('Evento guardado', 'success'); reload();
    },
  });
}

async function renderEventos(host) {
  host.innerHTML = '<div class="spinner">Cargando…</div>';
  let events;
  try { events = await eventsApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderEventos(host);
  host.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn btn-accent" id="new-ev">+ Nuevo evento</button></div>
    <p class="help">Agrupá los gastos de cada evento (catering) y mirá tu <strong>margen</strong> (cobrado − gastado). Cargá los ítems a mano, pegando una planilla o sacándole una <strong>foto a la lista</strong>.</p>
    ${!events.length ? '<div class="panel"><div class="empty">Sin eventos. Creá el primero con "+ Nuevo evento".</div></div>'
    : `<div class="list">${events.map((e) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${esc(e.name)} ${e.pax ? `<span class="badge badge-muted">${e.pax} pax</span>` : ''}</div>
          <div class="li-sub">${new Date(e.date).toLocaleDateString('es-AR')}${e.description ? ' · ' + esc(e.description) : ''} · ${e.items} ítems</div>
          <div class="li-sub">Cobrado ${money.format(e.revenue || 0)} · Gastado ${money.format(e.spent || 0)} · <strong style="color:${e.margin >= 0 ? 'var(--success)' : 'var(--danger)'}">Margen ${money.format(e.margin)}</strong></div>
        </div>
        <div class="li-actions"><button class="btn btn-sm btn-accent" data-open="${e.id}">Abrir</button><button class="btn btn-sm btn-danger" data-delev="${e.id}">Eliminar</button></div>
      </div>`).join('')}</div>`}`;
  host.querySelector('#new-ev').addEventListener('click', () => openEventForm(null, reload));
  host.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEvent(host, b.dataset.open)));
  host.querySelectorAll('[data-delev]').forEach((b) => b.addEventListener('click', async () => {
    const e = events.find((x) => x.id === b.dataset.delev);
    if (await confirmDialog(`¿Eliminar "${e.name}" y todos sus ítems? Es irreversible.`)) { await eventsApi.remove(e.id); toast('Evento eliminado', 'success'); reload(); }
  }));
}

async function openEvent(host, id) {
  host.innerHTML = '<div class="spinner">Cargando…</div>';
  let ev;
  try { ev = await eventsApi.get(id); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => openEvent(host, id);
  const vendors = [...new Set((ev.items || []).map((x) => x.vendor).filter(Boolean))];
  const itemRow = (x) => {
    const prod = x.items?.[0]?.desc || x.vendor || 'Ítem';
    return `<div class="list-item">
      <div class="li-main"><div class="li-title">${esc(prod)}</div><div class="li-sub">${x.vendor ? esc(x.vendor) : ''}${x.note ? (x.vendor ? ' · ' : '') + esc(x.note) : ''}</div></div>
      <div class="li-amt">${money.format(x.total)}</div>
      <div class="li-actions"><button class="btn btn-sm btn-danger" data-deli="${x._id}">✕</button></div>
    </div>`;
  };
  host.innerHTML = `
    <button class="btn btn-sm" id="ev-back">← Volver a eventos</button>
    <div class="panel" style="margin-top:10px">
      <div class="view-head" style="margin:0 0 6px"><h2>${esc(ev.name)}</h2><button class="btn btn-sm" id="ev-edit">Editar evento</button></div>
      <div class="li-sub">${new Date(ev.date).toLocaleDateString('es-AR')}${ev.pax ? ` · ${ev.pax} pax` : ''}${ev.description ? ` · ${esc(ev.description)}` : ''}</div>
      <div class="kpi-grid" style="margin-top:12px">
        <div class="kpi"><div class="label">Cobrado</div><div class="value">${money.format(ev.revenue || 0)}</div></div>
        <div class="kpi"><div class="label">Gastado</div><div class="value">${money.format(ev.spent || 0)}</div></div>
        <div class="kpi"><div class="label">Margen</div><div class="value" style="color:${ev.margin >= 0 ? 'var(--success)' : 'var(--danger)'}">${money.format(ev.margin)} <span class="delta">${ev.revenue ? Math.round((ev.margin / ev.revenue) * 100) + '%' : ''}</span></div></div>
      </div>
    </div>
    <div class="panel">
      <h2>Cargar ítems</h2>
      <p class="muted" style="margin:0 0 10px;font-size:13px">Agregá filas (producto · proveedor · monto · cantidad), pegá una planilla o sacale una foto a la lista. Después tocá "Guardar ítems".</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn" id="add-row">+ Fila</button>
        <button class="btn" id="paste-rows">Pegar planilla</button>
        <button class="btn" id="photo-rows">📷 Desde foto</button>
        <input type="file" accept="image/*" id="ev-photo" hidden />
      </div>
      <datalist id="ev-vendors">${vendors.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>
      <div id="ev-rows"></div>
      <button class="btn btn-accent" id="save-items" style="margin-top:10px;display:none">Guardar ítems</button>
    </div>
    <div class="panel">
      <h2>Ítems del evento (${ev.items.length})</h2>
      ${ev.items.length ? `<div class="list">${ev.items.map(itemRow).join('')}</div>` : '<div class="empty">Sin ítems todavía.</div>'}
    </div>`;

  const rowsBox = host.querySelector('#ev-rows');
  const saveBtn = host.querySelector('#save-items');
  const refreshSave = () => { saveBtn.style.display = rowsBox.querySelector('.ev-row') ? '' : 'none'; };
  const addRow = (v = {}) => {
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.innerHTML = `
      <input class="input r-name" placeholder="Producto" value="${esc(v.name || '')}" />
      <input class="input r-vendor" list="ev-vendors" placeholder="Proveedor" value="${esc(v.vendor || '')}" />
      <input class="input r-amount" type="number" step="0.01" min="0" placeholder="Monto" value="${v.amount || ''}" />
      <input class="input r-note" placeholder="Cantidad" value="${esc(v.note || '')}" />
      <button class="btn btn-sm btn-danger r-del" title="Quitar">✕</button>`;
    rowsBox.appendChild(row);
    row.querySelector('.r-del').addEventListener('click', () => { row.remove(); refreshSave(); });
    row.querySelector('.r-note').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
    refreshSave();
    return row;
  };
  const collect = () => [...rowsBox.querySelectorAll('.ev-row')].map((r) => ({
    name: r.querySelector('.r-name').value.trim(),
    vendor: r.querySelector('.r-vendor').value.trim() || undefined,
    amount: Number(r.querySelector('.r-amount').value) || 0,
    note: r.querySelector('.r-note').value.trim() || undefined,
  })).filter((i) => i.name && i.amount > 0);

  host.querySelector('#ev-back').addEventListener('click', () => renderEventos(host));
  host.querySelector('#ev-edit').addEventListener('click', () => openEventForm(ev, reload));
  host.querySelector('#add-row').addEventListener('click', () => addRow().querySelector('.r-name').focus());
  saveBtn.addEventListener('click', async () => {
    const items = collect();
    if (!items.length) { toast('Completá producto y monto', 'info'); return; }
    try { const r = await eventsApi.addItems(id, items); toast(`${r.added} ítem(s) agregados`, 'success'); reload(); }
    catch (ex) { toast(ex.message || 'No se pudieron guardar', 'error'); }
  });
  host.querySelector('#paste-rows').addEventListener('click', () => formModal({
    title: 'Pegar planilla',
    submitLabel: 'Cargar filas',
    fields: [{ name: 'txt', label: 'Pegá las filas (de Excel/Sheets)', type: 'textarea', placeholder: 'producto  proveedor  monto  cantidad\n(una fila por línea)' }],
    onSubmit: async (v) => {
      const rows = (v.txt || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const c = l.split(/\t|;|,| {2,}/).map((s) => s.trim());
        return { name: c[0] || '', vendor: c[1] || '', amount: Number(String(c[2] || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0, note: c[3] || '' };
      }).filter((i) => i.name);
      if (!rows.length) throw new Error('No pude leer filas');
      rows.forEach(addRow);
      toast(`${rows.length} fila(s) cargadas — revisá y "Guardar ítems"`, 'success');
    },
  }));
  const photoInput = host.querySelector('#ev-photo');
  host.querySelector('#photo-rows').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0]; if (!file) return;
    toast('Leyendo la lista con IA…', 'info');
    try {
      const r = await eventItemsFromPhoto(id, file);
      const rows = (r.items || []).filter((i) => i.name);
      if (!rows.length) { toast('No detecté filas en la foto', 'info'); return; }
      rows.forEach(addRow);
      toast(`${rows.length} fila(s) detectadas — revisá y "Guardar ítems"`, 'success');
    } catch (ex) { toast(ex.status === 503 ? 'Falta configurar ANTHROPIC_API_KEY' : (ex.message || 'No se pudo leer la foto'), 'error'); }
  });
  host.querySelectorAll('[data-deli]').forEach((b) => b.addEventListener('click', async () => {
    await expensesApi.remove(b.dataset.deli); toast('Ítem eliminado', 'success'); reload();
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
  const lines = ['fecha,producto,proveedor,cantidad,precio,categoria,moneda'];
  for (const x of rows) {
    lines.push([new Date(x.date).toISOString().slice(0, 10), cell(x.items?.[0]?.desc || ''), cell(x.vendor || ''), cell(x.note || ''), x.total ?? 0, x.category || 'other', x.currency || 'ARS'].join(','));
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
  const iProduct = idx(['producto', 'product', 'item', 'detalle']); const iNote = idx(['cantidad', 'cant', 'qty']);
  const iCat = idx(['categoria', 'category', 'categoría']); const iTotal = idx(['precio', 'total', 'monto', 'importe']);
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCSVLine(lines[i]);
    const total = Number(String(iTotal >= 0 ? c[iTotal] : '').replace(/[^0-9.,-]/g, '').replace(',', '.'));
    if (!total) continue;
    out.push({
      date: iDate >= 0 ? (c[iDate] || '').trim() : undefined,
      product: iProduct >= 0 ? (c[iProduct] || '').trim() : undefined,
      vendor: iVendor >= 0 ? (c[iVendor] || '').trim() : undefined,
      note: iNote >= 0 ? (c[iNote] || '').trim() : undefined,
      category: iCat >= 0 ? (c[iCat] || '').trim().toLowerCase() : undefined,
      total,
    });
  }
  return out;
}

/* ===================== AJUSTES ===================== */
export async function renderAjustes(host) {
  loading(host);
  let tenant; let user; let usage;
  try {
    const [t, m, u] = await Promise.all([tenantApi.get(), me(), tenantApi.usage().catch(() => null)]);
    tenant = t; user = m.user; usage = u;
  } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const storeUrl = `${location.origin}/r/${tenant.slug}`;
  const ig = tenant.integrations || {};
  const open = tenant.settings?.storeOpen !== false;
  const logoUrl = tenant.branding?.logo;
  const coverUrl = tenant.branding?.cover;
  const cats = tenant.settings?.categories || [];
  const om = tenant.settings?.orderMessages || {};
  const wlAllowed = tenant.whitelabelAllowed === true; // ¿el plan habilita marca blanca?
  const wlOn = tenant.settings?.whitelabel !== false;
  const coverPos = Number.isFinite(tenant.branding?.coverPos) ? tenant.branding.coverPos : 50;
  const menuLayout = tenant.settings?.menuLayout || 'list';
  const itemDetail = tenant.settings?.itemDetail === true;
  const cmd = getComanda(); // preferencias de impresión (por dispositivo)
  // Plan y uso (Infinity llega como null = sin límite)
  const planId = usage?.plan || tenant.plan || 'free';
  const plans = usage?.plans || {};
  const used = usage?.usage || {};
  const lim = usage?.limits || {};
  const limTxt = (v) => (v == null ? '∞' : num.format(v));
  const usageBar = (val, max) => {
    if (max == null) return '';
    const pct = Math.min(100, Math.round((val / max) * 100));
    const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--accent)' : 'var(--success)';
    return `<div style="height:8px;background:var(--surface-2);border-radius:6px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${pct}%;background:${color}"></div></div>`;
  };
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
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
      <label class="field-check"><input type="checkbox" id="allow-cancel" ${tenant.settings?.allowCancel !== false ? 'checked' : ''}/> Permitir que el cliente cancele su pedido</label>
      <p class="muted" style="margin:6px 0 0;font-size:12px">Si está activo, el cliente puede cancelar desde el seguimiento <strong>mientras el pedido siga "Nuevo"</strong> (sin confirmar). Si lo desactivás, no aparece el botón de cancelar.</p>
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
    ${wlAllowed ? `<div class="panel">
      <h2>Marca</h2>
      <p class="muted" style="margin:0 0 12px">Tu plan incluye <strong>marca blanca</strong>: podés ocultar "RestaurApp" y mostrar tu logo y nombre en el panel y en tu landing. (El logo se carga en "Logo y portada".)</p>
      <label class="field-check"><input type="checkbox" id="wl-toggle" ${wlOn ? 'checked' : ''}/> Usar mi marca (ocultar "RestaurApp")</label>
    </div>` : ''}
    <div class="panel">
      <h2>Notificaciones de pedidos</h2>
      <p class="muted" style="margin:0 0 12px">Cuando entra un pedido nuevo, la app suena y te avisa (tené la sección <strong>Pedidos</strong> abierta). Elegí el tono.</p>
      <label class="field-check"><input type="checkbox" id="snd-on" ${soundEnabled() ? 'checked' : ''}/> Sonido al recibir un pedido</label>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:130px;margin-top:10px"><label>Tono</label>
          <select class="input" id="snd-tone">${Object.entries(TONE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="field" style="flex:1;min-width:130px;margin-top:10px"><label>Intensidad de la alarma</label>
          <select class="input" id="snd-level">
            <option value="slow">Suave</option>
            <option value="medium">Media</option>
            <option value="strong">Fuerte (alta + repetida)</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-sm" id="snd-test">▶ Probar sonido</button>
        <button class="btn btn-sm" id="notif-perm">Activar avisos del sistema</button>
      </div>
    </div>
    <div class="panel">
      <h2>Comanda / impresión</h2>
      <p class="muted" style="margin:0 0 12px">Imprimí el ticket de cocina por pedido. Es <strong>por dispositivo</strong> (cada PC configura su impresora) y <strong>no requiere instalar nada</strong>.</p>
      <label class="field-check"><input type="checkbox" id="cmd-on" ${cmd.on ? 'checked' : ''}/> Activar comanda (muestra 🖨️ en cada pedido)</label>
      <div class="field" style="margin-top:10px"><label>Método de impresión</label>
        <select class="input" id="cmd-method">
          <option value="system" ${cmd.method === 'system' ? 'selected' : ''}>Impresora del sistema (diálogo · cualquier dispositivo)</option>
          <option value="thermal" ${cmd.method === 'thermal' ? 'selected' : ''}>Térmica directa USB, sin diálogo (Chrome/Edge de escritorio)</option>
        </select>
      </div>
      <div class="hint" style="margin-top:6px;line-height:1.6">
        <strong>Impresora del sistema</strong> — cualquier impresora instalada en el equipo (térmica o común). Térmicas probadas: Epson TM-T20III / TM-m30, Star TSP143 / TSP654, Bixolon SRP-350, Xprinter XP-80 / XP-58, 3nstar RPT-008, Posiflex. También sirve una inkjet/láser normal y AirPrint en iPad.<br>
        <strong>Térmica directa USB</strong> — impresoras que se ven como <em>puerto serie/COM</em> (USB-serial). Suelen ser las económicas 58/80mm con chip CH340: POS-58, Goojprt PT-210, Xprinter XP-58 (modelos serie), 3nstar, o cualquiera con interfaz serial real. <em>Truco:</em> si al tocar "Conectar impresora" aparece un puerto, te sirve. Las que son solo "USB printer class" (varias Epson/Star USB) no aparecen como COM → en esas usá el método del sistema.
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:120px"><label>Ancho</label>
          <select class="input" id="cmd-width"><option value="80" ${cmd.width === '80' ? 'selected' : ''}>80 mm</option><option value="58" ${cmd.width === '58' ? 'selected' : ''}>58 mm</option></select>
        </div>
        <div class="field" style="flex:1;min-width:120px"><label>Copias</label>
          <input class="input" type="number" min="1" max="5" id="cmd-copies" value="${cmd.copies || 1}" />
        </div>
      </div>
      <div class="field" id="cmd-baud-row" style="${cmd.method === 'thermal' ? '' : 'display:none'}"><label>Velocidad (baud · modo térmico)</label>
        <select class="input" id="cmd-baud">${[9600, 19200, 38400, 115200].map((b) => `<option value="${b}" ${Number(cmd.baud) === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
      </div>
      <label class="field-check" style="margin-top:8px"><input type="checkbox" id="cmd-auto" ${cmd.auto ? 'checked' : ''}/> Imprimir automáticamente al entrar un pedido nuevo</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-sm" id="cmd-connect" style="${cmd.method === 'thermal' ? '' : 'display:none'}">Conectar impresora</button>
        <button class="btn btn-sm btn-accent" id="cmd-test">Probar impresión</button>
      </div>
    </div>
    <div class="panel">
      <h2>Mensajes a clientes (WhatsApp)</h2>
      <p class="muted" style="margin:0 0 12px">Personalizá lo que recibe el cliente por WhatsApp en cada estado del pedido. Si lo dejás vacío, se usa el texto por defecto. Requiere WhatsApp Business conectado.</p>
      ${Object.entries(MSG_LABELS).map(([k, label]) => `<div class="kv"><span>${label}</span><span class="muted" style="text-align:right;max-width:62%">${esc(om[k] || DEFAULT_MSG[k])}</span></div>`).join('')}
      <button class="btn btn-sm" id="edit-msgs" style="margin-top:12px">Editar mensajes</button>
    </div>
    <div class="panel">
      <h2>Diseño de la landing</h2>
      ${coverUrl ? `
      <p class="muted" style="margin:0 0 8px">Encuadre de la portada: arrastrá para elegir qué parte se ve. La previsualización es aproximada a tu landing.</p>
      <div id="cover-prev2" class="cover-adjust" style="background-image:url('${esc(coverUrl)}');background-position:center ${coverPos}%"></div>
      <input type="range" id="cover-pos" min="0" max="100" value="${coverPos}" style="width:100%;margin-top:10px" />`
    : '<p class="muted" style="margin:0 0 8px">Subí una portada en "Logo y portada" para poder ajustar su encuadre.</p>'}
      <div class="field" style="margin-top:14px"><label>Diseño del menú</label>
        <select class="input" id="menu-layout">
          <option value="list" ${menuLayout === 'list' ? 'selected' : ''}>Lista (todo junto, con accesos por categoría)</option>
          <option value="tabs" ${menuLayout === 'tabs' ? 'selected' : ''}>Fichas por categoría (una a la vez)</option>
        </select>
      </div>
      <label class="field-check" style="margin-top:10px"><input type="checkbox" id="item-detail" ${itemDetail ? 'checked' : ''}/> Al tocar un ítem, abrir su detalle (sin perder el carrito)</label>
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
      <h2>Plan y uso</h2>
      <p class="muted" style="margin:0 0 12px">Tu plan define cuántos <strong>productos</strong> y <strong>pedidos por mes</strong> podés tener. Los planes pagos se cobran por <strong>suscripción mensual con Mercado Pago</strong>; al confirmar el pago tu plan se activa solo. Bajar a Free es inmediato.</p>
      <div class="kv"><span>Plan actual</span><strong>${esc(plans[planId]?.label || planId)}</strong></div>
      <div style="margin-top:12px">
        <div class="kv"><span>Productos</span><strong>${num.format(used.products || 0)} / ${limTxt(lim.products)}</strong></div>
        ${usageBar(used.products || 0, lim.products)}
      </div>
      <div style="margin-top:12px">
        <div class="kv"><span>Pedidos este mes</span><strong>${num.format(used.ordersThisMonth || 0)} / ${limTxt(lim.ordersPerMonth)}</strong></div>
        ${usageBar(used.ordersThisMonth || 0, lim.ordersPerMonth)}
      </div>
      <h3 style="margin:16px 0 8px;font-size:14px">Cambiar de plan</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${Object.entries(plans).map(([id, p]) => `<button class="btn btn-sm ${id === planId ? 'btn-accent' : ''}" data-plan="${id}" ${id === planId ? 'disabled' : ''}>${esc(p.label)} · ${p.priceMonthly ? `${money.format(p.priceMonthly)}/mes` : 'gratis'}</button>`).join('')}
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">${esc(plans[planId]?.blurb || '')}</p>
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
  const sndLevel = host.querySelector('#snd-level'); if (sndLevel) sndLevel.value = getAlarmLevel();
  sndLevel?.addEventListener('change', () => { setAlarmLevel(sndLevel.value); playPing(true); });
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

  // Cambiar de plan: el plan gratis es inmediato; los pagos van por Mercado Pago
  // (si todavía no hay credenciales de cobro, el backend responde modo manual).
  host.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.plan; const label = plans[id]?.label || id; const price = plans[id]?.priceMonthly || 0;
    if (id === 'free' || price === 0) {
      if (!(await confirmDialog(`¿Cambiar tu plan a ${label}?`, { danger: false }))) return;
      try { await tenantApi.setPlan(id); toast(`Plan cambiado a ${label}`, 'success'); renderAjustes(host); }
      catch (ex) { toast(ex.message || 'No se pudo cambiar el plan', 'error'); }
      return;
    }
    if (!(await confirmDialog(`Suscripción al plan ${label} por ${money.format(price)}/mes. ¿Continuar?`, { danger: false }))) return;
    try {
      const r = await tenantApi.checkout(id);
      if (r.mode === 'checkout' && r.url) { toast('Te llevamos a Mercado Pago…', 'info'); window.location.href = r.url; return; }
      // Modo manual: aún no hay cobro configurado, activamos el plan igual.
      await tenantApi.setPlan(id);
      toast(`Plan ${label} activado (sin cobro: configurá Mercado Pago para cobrar)`, 'success');
      renderAjustes(host);
    } catch (ex) { toast(ex.message || 'No se pudo iniciar el cobro', 'error'); }
  }));

  host.querySelector('#toggle-store')?.addEventListener('click', async () => {
    try { await tenantApi.update({ settings: { storeOpen: !open } }); toast(open ? 'Tienda cerrada' : 'Tienda abierta', 'success'); renderAjustes(host); }
    catch (ex) { toast(ex.message || 'No se pudo cambiar el estado', 'error'); }
  });

  host.querySelector('#allow-cancel')?.addEventListener('change', async (e) => {
    try { await tenantApi.update({ settings: { allowCancel: e.target.checked } }); toast(e.target.checked ? 'Cancelación habilitada' : 'Cancelación deshabilitada', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo guardar', 'error'); e.target.checked = !e.target.checked; }
  });

  host.querySelector('#wl-toggle')?.addEventListener('change', async (e) => {
    try { await tenantApi.update({ settings: { whitelabel: e.target.checked } }); toast('Marca actualizada · recargá para verla en el topbar', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo guardar', 'error'); e.target.checked = !e.target.checked; }
  });

  // Diseño de la landing
  const coverRange = host.querySelector('#cover-pos');
  const coverPrev = host.querySelector('#cover-prev2');
  coverRange?.addEventListener('input', () => { if (coverPrev) coverPrev.style.backgroundPosition = `center ${coverRange.value}%`; });
  coverRange?.addEventListener('change', async () => {
    try { await tenantApi.update({ branding: { coverPos: Number(coverRange.value) } }); toast('Encuadre de portada guardado', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo guardar', 'error'); }
  });
  host.querySelector('#menu-layout')?.addEventListener('change', async (e) => {
    try { await tenantApi.update({ settings: { menuLayout: e.target.value } }); toast('Diseño del menú actualizado', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo guardar', 'error'); }
  });
  host.querySelector('#item-detail')?.addEventListener('change', async (e) => {
    try { await tenantApi.update({ settings: { itemDetail: e.target.checked } }); toast(e.target.checked ? 'Detalle de ítem activado' : 'Detalle de ítem desactivado', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo guardar', 'error'); e.target.checked = !e.target.checked; }
  });

  // Comanda / impresión (preferencias por dispositivo, en localStorage)
  const cmdMethod = host.querySelector('#cmd-method');
  const syncCmd = () => {
    const th = cmdMethod?.value === 'thermal';
    const baudRow = host.querySelector('#cmd-baud-row'); if (baudRow) baudRow.style.display = th ? '' : 'none';
    const conn = host.querySelector('#cmd-connect'); if (conn) conn.style.display = th ? '' : 'none';
  };
  host.querySelector('#cmd-on')?.addEventListener('change', (e) => setComanda({ on: e.target.checked }));
  cmdMethod?.addEventListener('change', () => { setComanda({ method: cmdMethod.value }); syncCmd(); });
  host.querySelector('#cmd-width')?.addEventListener('change', (e) => setComanda({ width: e.target.value }));
  host.querySelector('#cmd-copies')?.addEventListener('change', (e) => setComanda({ copies: Math.max(1, Math.min(5, Number(e.target.value) || 1)) }));
  host.querySelector('#cmd-baud')?.addEventListener('change', (e) => setComanda({ baud: Number(e.target.value) }));
  host.querySelector('#cmd-auto')?.addEventListener('change', (e) => setComanda({ auto: e.target.checked }));
  host.querySelector('#cmd-connect')?.addEventListener('click', async () => {
    try { await connectThermal(); toast('Impresora conectada', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo conectar', 'error'); }
  });
  host.querySelector('#cmd-test')?.addEventListener('click', async () => {
    try { await testComanda(tenant.name); toast('Enviado a imprimir', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo imprimir', 'error'); }
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
      { name: 'phone', label: 'WhatsApp de contacto', value: tenant.branding?.phone, placeholder: 'Ej. +54 9 11 1234-5678', help: 'Aparece en tu landing para que el cliente pueda seguir su pedido por WhatsApp.' },
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
        branding: { description: v.description, logo: v.logo || '', cover: v.cover || '', colors: { accent: v.accent }, cuisine: v.cuisine, phone: v.phone },
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

/* ===================== ADMIN (root / dueño de la app) ===================== */
export async function renderAdmin(host) {
  loading(host);
  let data;
  try { data = await adminApi.overview(); }
  catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const reload = () => renderAdmin(host);
  const { totals, plans, tenants } = data;
  const planOpts = Object.keys(plans);
  const lim = (v) => (v == null ? '' : v);

  const planCard = (id) => {
    const p = plans[id];
    const chk = (k) => (p.features?.[k] ? 'checked' : '');
    return `<div class="panel">
      <h3 style="margin:0 0 10px">Plan: ${esc(p.label)}</h3>
      <div class="field"><label>Nombre</label><input class="input" data-pf="${id}.label" value="${esc(p.label)}" /></div>
      <div class="field"><label>Precio mensual (ARS)</label><input class="input" type="number" min="0" data-pf="${id}.priceMonthly" value="${p.priceMonthly || 0}" /></div>
      <div class="field"><label>Límite de productos <span class="muted">(vacío = sin límite)</span></label><input class="input" type="number" min="0" data-pf="${id}.products" value="${lim(p.limits?.products)}" /></div>
      <div class="field"><label>Límite de pedidos/mes <span class="muted">(vacío = sin límite)</span></label><input class="input" type="number" min="0" data-pf="${id}.orders" value="${lim(p.limits?.ordersPerMonth)}" /></div>
      <label class="field-check"><input type="checkbox" data-pf="${id}.ai" ${chk('ai')} /> IA (importar, OCR, forecast, foto, campañas)</label>
      <label class="field-check"><input type="checkbox" data-pf="${id}.integrations" ${chk('integrations')} /> Integraciones (WhatsApp / Instagram / Mercado Pago)</label>
      <label class="field-check"><input type="checkbox" data-pf="${id}.whitelabel" ${chk('whitelabel')} /> Marca blanca (logo propio, sin "RestaurApp")</label>
      <button class="btn btn-accent btn-sm" data-save-plan="${id}" style="margin-top:12px">Guardar plan ${esc(p.label)}</button>
    </div>`;
  };

  host.innerHTML = `
    <div class="view-head"><h1>Administración</h1><span class="muted">${num.format(totals.tenants)} comercios</span></div>
    <p class="help">Panel del dueño de la plataforma (cuenta root). Configurá <strong>qué incluye cada plan</strong> (límites y funciones), mirá la actividad de cada comercio y cambiales el plan. El <strong>MRR estimado</strong> suma las cuotas de los planes pagos activos.</p>
    <div class="kpi-grid">
      <div class="kpi"><div class="label">Comercios</div><div class="value">${num.format(totals.tenants)}</div></div>
      <div class="kpi"><div class="label">MRR estimado</div><div class="value">${money.format(totals.mrr || 0)}</div></div>
      <div class="kpi"><div class="label">Free</div><div class="value">${num.format(totals.byPlan.free || 0)}</div></div>
      <div class="kpi"><div class="label">Pro</div><div class="value">${num.format(totals.byPlan.pro || 0)}</div></div>
      <div class="kpi"><div class="label">Business</div><div class="value">${num.format(totals.byPlan.business || 0)}</div></div>
    </div>
    <h2 style="margin:22px 0 10px">Planes (qué puede cada uno)</h2>
    <div class="panel-grid">${planOpts.map(planCard).join('')}</div>
    <h2 style="margin:22px 0 10px">Comercios</h2>
    ${!tenants.length ? '<div class="panel"><div class="empty">Todavía no hay comercios registrados.</div></div>'
    : `<div class="list">${tenants.map((t) => `
      <div class="list-item">
        <div class="li-main">
          <div class="li-title">${esc(t.name)} <span class="badge badge-muted">${esc(t.slug)}</span></div>
          <div class="li-sub">${esc(t.ownerEmail)} · ${num.format(t.products)} productos · ${num.format(t.orders)} pedidos · ${money.format(t.revenue)} cobrado</div>
          <div class="li-sub">Alta ${new Date(t.createdAt).toLocaleDateString('es-AR')}</div>
        </div>
        <div class="li-actions">
          <button class="btn btn-sm ${t.unread ? 'btn-accent' : ''}" data-chat="${t.id}" data-name="${esc(t.name)}">💬${t.unread ? ` ${t.unread}` : ''}</button>
          <button class="btn btn-sm" data-tenant="${t.id}">Detalle</button>
          <a class="btn btn-sm" href="${location.origin}/r/${esc(t.slug)}" target="_blank" rel="noopener">Landing ↗</a>
          <select class="input" data-plan-for="${t.id}" style="width:auto;min-height:38px;padding:6px 10px">
            ${planOpts.map((p) => `<option value="${p}" ${p === t.plan ? 'selected' : ''}>${esc(plans[p].label)}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-danger" data-del-tenant="${t.id}" data-name="${esc(t.name)}">Eliminar</button>
        </div>
      </div>`).join('')}</div>`}`;

  host.querySelectorAll('[data-plan-for]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await adminApi.setPlan(sel.dataset.planFor, sel.value); toast('Plan del comercio actualizado', 'success'); }
    catch (ex) { toast(ex.message || 'No se pudo cambiar el plan', 'error'); reload(); }
  }));

  host.querySelectorAll('[data-save-plan]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.savePlan;
    const get = (suffix) => host.querySelector(`[data-pf="${id}.${suffix}"]`);
    const numOrNull = (el) => { const v = (el?.value ?? '').trim(); return v === '' ? null : Number(v); };
    const body = {
      label: get('label').value.trim() || id,
      priceMonthly: Number(get('priceMonthly').value) || 0,
      limits: { products: numOrNull(get('products')), ordersPerMonth: numOrNull(get('orders')) },
      features: { ai: get('ai').checked, integrations: get('integrations').checked, whitelabel: get('whitelabel').checked },
    };
    try { await adminApi.setPlanConfig(id, body); toast(`Plan ${body.label} guardado`, 'success'); reload(); }
    catch (ex) { toast(ex.message || 'No se pudo guardar el plan', 'error'); }
  }));

  host.querySelectorAll('[data-chat]').forEach((b) => b.addEventListener('click', () => openTenantChat(b.dataset.chat, b.dataset.name)));
  host.querySelectorAll('[data-del-tenant]').forEach((b) => b.addEventListener('click', async () => {
    const name = b.dataset.name || 'este comercio';
    if (!(await confirmDialog(`¿Eliminar "${name}" y TODOS sus datos (menú, pedidos, gastos, usuarios)? Esta acción es irreversible.`))) return;
    try { await adminApi.deleteTenant(b.dataset.delTenant); toast('Comercio eliminado', 'success'); reload(); }
    catch (ex) { toast(ex.message || 'No se pudo eliminar', 'error'); }
  }));

  host.querySelectorAll('[data-tenant]').forEach((b) => b.addEventListener('click', async () => {
    let d;
    try { d = await adminApi.tenantDetail(b.dataset.tenant); }
    catch (ex) { toast(ex.message || 'No se pudo cargar el detalle', 'error'); return; }
    const st = d.orders?.byStatus || {};
    const statusRows = ORDER_FLOW.concat('cancelled').filter((s) => st[s])
      .map((s) => `<div class="kv"><span>${ORDER_LABEL[s] || s}</span><strong>${num.format(st[s])}</strong></div>`).join('') || '<div class="muted">Sin pedidos.</div>';
    infoModal({
      title: `${d.name} · ${d.slug}`,
      html: `
        <div class="kv"><span>Dueño</span><strong>${esc(d.ownerEmail)}</strong></div>
        <div class="kv"><span>Plan</span><strong>${esc(plans[d.plan]?.label || d.plan)}</strong></div>
        <div class="kv"><span>Alta</span><strong>${new Date(d.createdAt).toLocaleDateString('es-AR')}</strong></div>
        <div class="kv"><span>Ítems de menú</span><strong>${num.format(d.products)}</strong></div>
        <div class="kv"><span>Pedidos (total)</span><strong>${num.format(d.orders?.total || 0)}</strong></div>
        <div class="kv"><span>Ventas cobradas</span><strong>${num.format(d.paid?.count || 0)} · ${money.format(d.paid?.revenue || 0)}</strong></div>
        <div class="kv"><span>Gastos</span><strong>${num.format(d.expenses?.count || 0)} · ${money.format(d.expenses?.total || 0)}</strong></div>
        <div class="kv"><span>Campañas</span><strong>${num.format(d.campaigns || 0)}</strong></div>
        <div class="kv"><span>Último pedido</span><strong>${d.lastOrder ? `#${esc(d.lastOrder.code)} · ${new Date(d.lastOrder.createdAt).toLocaleDateString('es-AR')}` : '—'}</strong></div>
        <h3 style="margin:14px 0 6px;font-size:14px">Pedidos por estado</h3>
        ${statusRows}`,
    });
  }));
}

/* ===================== MENSAJES (chat comercio ↔ dueño de la app) ===================== */
function chatThreadHTML(msgs, mineFrom) {
  if (!msgs.length) return '<div class="empty">Todavía no hay mensajes. Escribí el primero.</div>';
  return msgs.map((m) => {
    const mine = m.from === mineFrom;
    const who = m.from === 'root' ? 'RestaurApp' : 'Comercio';
    const when = new Date(m.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="bubble ${mine ? 'mine' : 'them'}"><div class="b-text">${esc(m.text)}</div><div class="b-meta">${mine ? '' : `${who} · `}${when}</div></div>`;
  }).join('');
}

// Vista del comercio: chat con el equipo de la app.
export async function renderMensajes(host) {
  loading(host);
  let msgs;
  try { msgs = await messagesApi.list(); } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  host.innerHTML = `
    <div class="view-head"><h1>Mensajes</h1></div>
    <p class="help">Chat directo con el equipo de RestaurApp. Escribinos consultas, problemas o sugerencias.</p>
    <div class="chat" id="chat">${chatThreadHTML(msgs, 'tenant')}</div>
    <form class="chat-box" id="chat-form"><input class="input" id="chat-in" placeholder="Escribí un mensaje…" autocomplete="off" maxlength="2000" /><button class="btn btn-accent" type="submit">Enviar</button></form>`;
  const chat = host.querySelector('#chat'); chat.scrollTop = chat.scrollHeight;
  const input = host.querySelector('#chat-in');
  host.querySelector('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = '';
    try { await messagesApi.send(text); const m = await messagesApi.list(); chat.innerHTML = chatThreadHTML(m, 'tenant'); chat.scrollTop = chat.scrollHeight; }
    catch (ex) { toast(ex.message || 'No se pudo enviar', 'error'); input.value = text; }
  });
  onInterval(async () => {
    if (document.visibilityState !== 'visible' || !document.body.contains(chat)) return;
    try {
      const m = await messagesApi.list();
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
      chat.innerHTML = chatThreadHTML(m, 'tenant');
      if (atBottom) chat.scrollTop = chat.scrollHeight;
    } catch {}
  }, 15000);
}

// Modal de chat del root con un comercio.
function openTenantChat(id, name) {
  const ov = document.createElement('div'); ov.className = 'modal-overlay show';
  ov.innerHTML = `<div class="modal chat-modal">
    <div class="modal-head"><h3>Chat · ${esc(name || '')}</h3><button class="modal-x" data-x aria-label="Cerrar">✕</button></div>
    <div class="chat" id="achat"></div>
    <form class="chat-box" id="achat-form"><input class="input" id="achat-in" placeholder="Escribí un mensaje…" autocomplete="off" maxlength="2000" /><button class="btn btn-accent" type="submit">Enviar</button></form>
  </div>`;
  document.body.appendChild(ov);
  const chat = ov.querySelector('#achat'); const input = ov.querySelector('#achat-in');
  let timer = null;
  const close = () => { ov.remove(); if (timer) clearInterval(timer); };
  ov.querySelector('[data-x]').onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  const refresh = async () => {
    try {
      const m = await adminApi.messages(id);
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
      chat.innerHTML = chatThreadHTML(m, 'root');
      if (atBottom) chat.scrollTop = chat.scrollHeight;
    } catch {}
  };
  ov.querySelector('#achat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = input.value.trim(); if (!t) return;
    input.value = '';
    try { await adminApi.sendMessage(id, t); await refresh(); }
    catch (ex) { toast(ex.message || 'No se pudo enviar', 'error'); input.value = t; }
  });
  refresh().then(() => { chat.scrollTop = chat.scrollHeight; });
  timer = setInterval(refresh, 15000);
}
