(() => {
  const app = document.getElementById('app');
  const slug = decodeURIComponent((location.pathname.split('/r/')[1] || '').replace(/\/+$/, ''));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let fmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  let tenant = null; let products = []; let byId = {}; const cart = {};

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
      document.title = `${tenant.name} — Pedí online`;
      render();
    } catch { app.innerHTML = '<div class="center">No se pudo cargar el menú. Probá de nuevo.</div>'; }
  }

  function totals() { let count = 0; let total = 0; for (const id in cart) { count += cart[id]; total += (byId[id]?.price || 0) * cart[id]; } return { count, total }; }

  function header() {
    return `<header class="hero"><p class="eyebrow">Pedí online · Envíos hoy</p><h1>${esc(tenant.name)}</h1><p>${esc(tenant.branding?.description || 'Hacé tu pedido y te contactamos para coordinar.')}</p></header>`;
  }
  function prodHTML(p) {
    const q = cart[p._id] || 0;
    return `<div class="prod" data-id="${p._id}">
      <div class="info"><div class="name">${esc(p.name)}</div>${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}<div class="price">${fmt.format(p.price)}</div></div>
      <div class="stepper">${q > 0 ? `<button class="qbtn" data-dec aria-label="Quitar">−</button><span class="qty">${q}</span>` : ''}<button class="qbtn add" data-inc aria-label="Agregar">+</button></div>
    </div>`;
  }
  function cartbarHTML() {
    const { count, total } = totals();
    return `<div class="cartbar ${count ? 'show' : ''}" id="cartbar"><span class="c-count">${count} ${count === 1 ? 'ítem' : 'ítems'} · ${fmt.format(total)}</span><span class="c-go">Hacer pedido</span></div>`;
  }

  function render() {
    if (!products.length) { app.innerHTML = header() + '<div class="wrap"><div class="center">Todavía no hay productos en la carta.</div></div>'; return; }
    const cats = {};
    for (const p of products) { const c = p.category || 'Menú'; (cats[c] ||= []).push(p); }
    let html = header() + '<div class="wrap">';
    for (const [cat, items] of Object.entries(cats)) { html += `<div class="cat">${esc(cat)}</div>`; for (const p of items) html += prodHTML(p); }
    html += '</div>' + cartbarHTML();
    app.innerHTML = html;
    app.querySelectorAll('.prod').forEach((el) => {
      const id = el.dataset.id;
      el.querySelector('[data-inc]')?.addEventListener('click', () => { cart[id] = (cart[id] || 0) + 1; render(); });
      el.querySelector('[data-dec]')?.addEventListener('click', () => { cart[id] = Math.max(0, (cart[id] || 0) - 1); if (!cart[id]) delete cart[id]; render(); });
    });
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
      <button class="btn btn-primary" id="again" style="max-width:300px;margin:24px auto 0">Hacer otro pedido</button>
    </div><div class="foot">Pedidos con RestaurApp</div>`;
    document.getElementById('again').addEventListener('click', () => location.reload());
  }
})();
