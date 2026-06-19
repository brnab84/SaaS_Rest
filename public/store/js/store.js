(() => {
  const app = document.getElementById('app');
  const slug = decodeURIComponent((location.pathname.split('/r/')[1] || '').replace(/\/+$/, ''));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  let tenant = null; let products = []; let byId = {}; const cart = {}; let storeOpen = true;
  let trackTimer = null; // timer del seguimiento de pedido (se limpia al salir de esa vista)
  const orderParam = new URLSearchParams(location.search).get('order'); // deep-link a seguimiento
  const waDigits = (p) => String(p || '').replace(/\D/g, '');
  const fmtTime = (d) => { try { return new Date(d).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const setFavicon = (url) => {
    if (!url) return;
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = url;
  };

  // Paletas de los 6 temas (igual que el panel) para que la landing use el mismo tema del comercio.
  const THEME_VARS = {
    comanda: { '--bg': '#f3ecd9', '--surface': '#fffdf6', '--surface-2': '#f7f1e1', '--text': '#2b2520', '--muted': '#8a7b58', '--accent': '#c0392b', '--border': '#e0d6bf' },
    brutalist: { '--bg': '#faf4e4', '--surface': '#ffffff', '--surface-2': '#fff6d6', '--text': '#16130f', '--muted': '#6b5f4d', '--accent': '#e2483d', '--border': '#16130f' },
    brasa: { '--bg': '#15110d', '--surface': '#211b15', '--surface-2': '#2a2219', '--text': '#f0e6d6', '--muted': '#a8967c', '--accent': '#ff7a1a', '--border': '#3a322a' },
    mercado: { '--bg': '#fbf9f3', '--surface': '#ffffff', '--surface-2': '#f0f3ec', '--text': '#21302a', '--muted': '#6f7d6a', '--accent': '#2f7d4f', '--border': '#e1ddcf' },
    neon: { '--bg': '#0e1116', '--surface': '#161b22', '--surface-2': '#1c2230', '--text': '#e6edf5', '--muted': '#8b97a8', '--accent': '#22d3ee', '--border': '#232b38' },
    tinta: { '--bg': '#ffffff', '--surface': '#ffffff', '--surface-2': '#f4f4f2', '--text': '#111111', '--muted': '#8a8a86', '--accent': '#d7263d', '--border': '#111111' },
    dragon: { '--bg': '#0d0b08', '--surface': '#181410', '--surface-2': '#241c14', '--text': '#f4ece0', '--muted': '#b09a7e', '--accent': '#eb6608', '--border': '#3a2e20' },
  };

  if (!slug) { app.innerHTML = '<div class="center">Comercio no especificado.</div>'; return; }
  load();

  async function load() {
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/menu`);
      if (res.status === 404) { app.innerHTML = '<div class="center">Este comercio no existe o no está disponible.</div>'; return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      tenant = data.tenant; products = data.products || [];
      byId = Object.fromEntries(products.map((p) => [p._id, p]));
      if (tenant.currency) fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: tenant.currency, maximumFractionDigits: 0 });
      const vars = THEME_VARS[tenant.branding?.theme];
      if (vars) for (const k in vars) document.documentElement.style.setProperty(k, vars[k]);
      const accent = tenant.branding?.colors?.accent; // el color custom prevalece sobre el del tema
      if (accent) document.documentElement.style.setProperty('--accent', accent);
      storeOpen = tenant.storeOpen !== false;
      document.title = `${tenant.name} — Pedí online`;
      if (tenant.branding?.logo) setFavicon(tenant.branding.logo); // favicon = logo del comercio
      if (orderParam) { showTracking(orderParam); return; } // si vienen con ?order=, mostramos el seguimiento
      render();
    } catch { app.innerHTML = '<div class="center">No se pudo cargar el menú. Probá de nuevo.</div>'; }
  }

  function totals() { let count = 0; let total = 0; for (const id in cart) { count += cart[id]; total += (byId[id]?.price || 0) * cart[id]; } return { count, total }; }

  function header() {
    const b = tenant.branding || {};
    const cover = b.cover ? `<div class="cover" style="background-image:url('${esc(b.cover)}')"></div>` : '<div class="cover"></div>';
    const logo = b.logo ? `<img class="logo" src="${esc(b.logo)}" alt="${esc(tenant.name)}" />` : '';
    const eyebrow = b.cuisine ? `${esc(b.cuisine)} · Pedí online` : 'Pedí online · Envíos hoy';
    return `${cover}<header class="hero">${logo}<p class="eyebrow">${eyebrow}</p><h1>${esc(tenant.name)}</h1><p>${esc(b.description || 'Hacé tu pedido y te contactamos para coordinar.')}</p></header>`;
  }
  function prodHTML(p) {
    const q = cart[p._id] || 0;
    const stepper = storeOpen
      ? `<div class="stepper">${q > 0 ? `<button class="qbtn" data-dec aria-label="Quitar">−</button><span class="qty">${q}</span>` : ''}<button class="qbtn add" data-inc aria-label="Agregar">+</button></div>`
      : '';
    return `<div class="prod" data-id="${p._id}">
      ${p.photo ? `<img class="pthumb" src="${esc(p.photo)}" alt="" loading="lazy" />` : ''}
      <div class="info"><div class="name">${esc(p.name)}</div>${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}<div class="price">${fmt.format(p.price)}</div></div>
      ${stepper}
    </div>`;
  }
  function cartbarHTML() {
    if (!storeOpen) return '';
    const { count, total } = totals();
    return `<div class="cartbar ${count ? 'show' : ''}" id="cartbar"><span class="c-count">${count} ${count === 1 ? 'ítem' : 'ítems'} · ${fmt.format(total)}</span><span class="c-go">Hacer pedido</span></div>`;
  }

  function render() {
    clearInterval(trackTimer); // por si veníamos del seguimiento
    if (!products.length) { app.innerHTML = header() + '<div class="wrap"><div class="center">Todavía no hay productos en la carta.</div></div>'; return; }
    const cats = {};
    for (const p of products) { const c = p.category || 'Menú'; (cats[c] ||= []).push(p); }
    const names = Object.keys(cats);
    const chips = names.length > 1 ? `<nav class="catbar">${names.map((c, i) => `<button class="chip" data-sec="sec-${i}">${esc(c)}</button>`).join('')}</nav>` : '';
    let html = header() + chips + '<div class="wrap">';
    if (!storeOpen) html += '<div class="closed">🔴 Cerrado ahora · No se reciben pedidos en este momento.</div>';
    names.forEach((cat, i) => { html += `<div class="cat" id="sec-${i}">${esc(cat)}</div>`; for (const p of cats[cat]) html += prodHTML(p); });
    html += '</div>' + cartbarHTML();
    app.innerHTML = html;
    app.querySelectorAll('.prod').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-inc]')?.addEventListener('click', () => { cart[id] = (cart[id] || 0) + 1; render(); });
      el.querySelector('[data-dec]')?.addEventListener('click', () => { cart[id] = Math.max(0, (cart[id] || 0) - 1); if (!cart[id]) delete cart[id]; render(); });
    });
    app.querySelectorAll('.catbar .chip').forEach((b) => b.addEventListener('click', () => document.getElementById(b.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
    document.getElementById('cartbar')?.addEventListener('click', openCheckout);
  }

  function openCheckout() {
    const { total } = totals();
    const lines = Object.entries(cart).map(([id, q]) => `<div class="line"><span>${q}× ${esc(byId[id].name)}</span><span>${fmt.format(byId[id].price * q)}</span></div>`).join('');
    const ov = document.createElement('div'); ov.className = 'sheet-ov show';
    ov.innerHTML = `<div class="sheet">
      <h2>Tu pedido</h2>${lines}<div class="line total"><span>Total</span><span>${fmt.format(total)}</span></div>
      <form id="co">
        <div class="field"><label>Tu nombre</label><input class="input" name="name" required></div>
        <div class="field"><label>WhatsApp / teléfono</label><input class="input" name="phone" inputmode="tel" required></div>
        <div class="field"><label>Dirección (opcional)</label><input class="input" name="address"></div>
        <div class="err" id="co-err"></div>
        <button class="btn btn-primary" type="submit" id="co-btn">Confirmar pedido</button>
        <button class="btn btn-ghost" type="button" id="co-cancel">Seguir mirando</button>
      </form></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#co-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#co').addEventListener('submit', (e) => submitOrder(e, ov));
  }

  async function submitOrder(e, ov) {
    e.preventDefault();
    const f = e.target; const btn = ov.querySelector('#co-btn'); const err = ov.querySelector('#co-err'); err.textContent = '';
    const items = Object.entries(cart).map(([productId, qty]) => ({ productId, qty }));
    if (!items.length) { err.textContent = 'Tu pedido está vacío.'; return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: { name: f.name.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim() || undefined }, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'No se pudo enviar el pedido');
      ov.remove(); showOk(data);
    } catch (ex) { err.textContent = ex.message || 'Error al enviar'; btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
  }

  function showOk(o) {
    clearInterval(trackTimer);
    const b = tenant.branding || {};
    const waBtn = b.phone ? '<button class="btn btn-ghost" id="ok-wa">Seguir por WhatsApp</button>' : '';
    app.innerHTML = `<div class="ok"><div class="check">✓</div><h2>¡Pedido recibido!</h2>
      <p style="color:var(--muted)">${esc(tenant.name)} te va a contactar para coordinar pago y entrega.</p>
      <div class="code">#${esc(o.code)}</div>
      <div class="line total" style="max-width:300px;margin:0 auto"><span>Total</span><span>${fmt.format(o.total)}</span></div>
      <p style="color:var(--muted);font-size:13px;max-width:320px;margin:16px auto 0">¿Cómo querés seguir tu pedido?</p>
      <div id="ok-actions" style="max-width:320px;margin:14px auto 0;display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" id="ok-track">Seguir mi pedido en la app</button>
        ${waBtn}
        <button class="btn btn-ghost" id="again">Hacer otro pedido</button>
      </div>
    </div><div class="foot">${tenant.whitelabel ? esc(tenant.name) : 'Pedidos con RestaurApp'}</div>`;
    document.getElementById('ok-track').addEventListener('click', () => showTracking(o.id));
    document.getElementById('again').addEventListener('click', goToMenu);
    if (b.phone) document.getElementById('ok-wa').addEventListener('click', () => openWaFollow(o));
  }

  // Vuelve al menú del local (limpia ?order= de la URL para no quedar en el seguimiento).
  function goToMenu() { location.href = location.pathname; }

  // Abre WhatsApp del comercio para consultar/seguir el pedido.
  function openWaFollow(o) {
    const phone = waDigits(tenant.branding?.phone);
    const text = encodeURIComponent(`Hola ${tenant.name}! Quiero seguir mi pedido #${o.code}.`);
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
  }

  // Seguimiento propio del pedido: muestra los estados y se actualiza solo.
  async function showTracking(orderId) {
    clearInterval(trackTimer);
    try { history.replaceState(null, '', `${location.pathname}?order=${orderId}`); } catch { /* sin permiso de history */ }
    app.innerHTML = header() + '<div class="wrap"><div class="center">Cargando tu pedido…</div></div>';
    const tick = async () => {
      let o;
      try {
        const res = await fetch(`/api/public/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}`);
        if (!res.ok) throw new Error();
        o = await res.json();
      } catch { clearInterval(trackTimer); app.innerHTML = header() + '<div class="wrap"><div class="center">No pudimos encontrar tu pedido.</div></div>'; return; }
      renderTracking(o);
      if (o.status === 'delivered' || o.status === 'cancelled') clearInterval(trackTimer); // estado final
    };
    await tick();
    trackTimer = setInterval(() => { if (document.visibilityState !== 'hidden') tick(); }, 8000);
  }

  function renderTracking(o) {
    const FLOW = [['new', 'Pedido recibido'], ['confirmed', 'Confirmado'], ['preparing', 'En preparación'], ['ready', 'Listo'], ['on_way', 'En camino'], ['delivered', 'Entregado']];
    const times = {}; (o.timeline || []).forEach((t) => { if (!times[t.status]) times[t.status] = t.at; });
    const b = tenant.branding || {};
    const cancelled = o.status === 'cancelled';
    const idx = FLOW.findIndex(([s]) => s === o.status);
    const steps = cancelled
      ? `<div class="step current cancelled"><span class="dot">✕</span><div class="s-main"><div class="s-label">Pedido cancelado</div>${times.cancelled ? `<div class="s-time">${fmtTime(times.cancelled)}</div>` : ''}</div></div>`
      : FLOW.map(([s, label], i) => {
        const done = i < idx; const current = i === idx;
        const t = times[s] ? `<div class="s-time">${fmtTime(times[s])}</div>` : '';
        return `<div class="step ${done ? 'done' : ''} ${current ? 'current' : ''}"><span class="dot">${done ? '✓' : (current ? '●' : '')}</span><div class="s-main"><div class="s-label">${label}</div>${t}</div></div>`;
      }).join('');
    const waBtn = b.phone ? '<button class="btn btn-ghost" id="t-wa">Consultar por WhatsApp</button>' : '';
    const canCancel = o.status === 'new' && tenant.allowCancel !== false; // el comercio puede deshabilitarlo
    const cancelBtn = canCancel ? '<button class="btn btn-ghost" id="t-cancel">Cancelar pedido</button>' : '';
    app.innerHTML = header() + `<div class="wrap"><div class="track">
      <div class="track-head"><h2>Seguimiento de tu pedido</h2><div class="code">#${esc(o.code)}</div></div>
      <div class="line total"><span>Total</span><span>${fmt.format(o.total)}</span></div>
      <div class="steps">${steps}</div>
      <div class="track-actions">${cancelBtn}${waBtn}<button class="btn btn-primary" id="t-again">Hacer otro pedido</button></div>
      <p class="track-hint">Esta página se actualiza sola a medida que avanza tu pedido. Guardá el link para volver a verla.</p>
    </div></div>`;
    document.getElementById('t-again').addEventListener('click', goToMenu);
    if (b.phone) document.getElementById('t-wa').addEventListener('click', () => openWaFollow(o));
    if (canCancel) {
      document.getElementById('t-cancel').addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Cancelando…';
        try {
          const res = await fetch(`/api/public/${encodeURIComponent(slug)}/orders/${o.id}/cancel`, { method: 'POST' });
          if (!res.ok) throw new Error();
          showTracking(o.id); // recarga el estado (ahora cancelado)
        } catch { btn.disabled = false; btn.textContent = 'Cancelar pedido'; }
      });
    }
  }
})();
