(() => {
  const app = document.getElementById('app');
  const slug = decodeURIComponent((location.pathname.split('/r/')[1] || '').replace(/\/+$/, ''));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  let tenant = null; let products = []; let byId = {}; const cart = {}; let storeOpen = true;

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
    app.innerHTML = `<div class="ok"><div class="check">✓</div><h2>¡Pedido recibido!</h2>
      <p style="color:var(--muted)">${esc(tenant.name)} te va a contactar para coordinar pago y entrega.</p>
      <div class="code">#${esc(o.code)}</div>
      <div class="line total" style="max-width:300px;margin:0 auto"><span>Total</span><span>${fmt.format(o.total)}</span></div>
      <div id="ok-actions" style="max-width:300px;margin:24px auto 0;display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" id="again">Hacer otro pedido</button>
        <button class="btn btn-ghost" id="cancel-order">Cancelar pedido</button>
      </div>
    </div><div class="foot">Pedidos con RestaurApp</div>`;
    document.getElementById('again').addEventListener('click', () => location.reload());
    document.getElementById('cancel-order').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Cancelando…';
      try {
        const res = await fetch(`/api/public/${encodeURIComponent(slug)}/orders/${o.id}/cancel`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message || 'No se pudo cancelar');
        const actions = document.getElementById('ok-actions');
        actions.innerHTML = '<div style="color:var(--muted);text-align:center">Tu pedido fue cancelado.</div><button class="btn btn-primary" id="again2">Hacer otro pedido</button>';
        document.getElementById('again2').addEventListener('click', () => location.reload());
      } catch (ex) {
        btn.disabled = false; btn.textContent = 'Cancelar pedido';
        const a = document.getElementById('ok-actions');
        let m = a.querySelector('.c-err'); if (!m) { m = document.createElement('div'); m.className = 'c-err'; m.style.cssText = 'color:var(--accent);text-align:center;font-size:13px'; a.appendChild(m); }
        m.textContent = ex.message || 'No se pudo cancelar';
      }
    });
  }
})();
