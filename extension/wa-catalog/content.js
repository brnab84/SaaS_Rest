/* RestaurApp — lector de catálogo de WhatsApp Web.
 * Corre como content script en web.whatsapp.com. Lee los productos del catálogo
 * abierto (uno por uno con "Modo clic", o todos los visibles con "Leer visible")
 * y los exporta a CSV con columnas nombre, precio, categoria, descripcion para
 * importarlos en RestaurApp (Menú → Importar CSV).
 *
 * Ojo: WhatsApp Web tiene el HTML ofuscado y cambia seguido, así que la lectura
 * usa heurísticas (patrones de precio + estructura), no clases fijas. Si algún
 * producto no se detecta, usá "Modo clic" y tocá cada uno.
 */
(() => {
  if (window.__raCatalogLoaded) return; // evita doble inyección
  window.__raCatalogLoaded = true;

  // Monedas/precios comunes en LATAM + genéricos.
  const PRICE_RE = /(?:\$|US\$|u\$s|usd|ars|eur|€|r\$|s\/|bs\.?|₲|gs\.?|g\$|cop|mxn|clp|pen|uyu|bob|pyg)\s*\d[\d.,]*/i;
  const onlyNumber = (s) => Number(String(s || '').replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));

  let captured = [];         // [{ name, price, desc, category }]
  let clickMode = false;
  let clickHandler = null;

  /* ---------- UI ---------- */
  function ui() {
    if (document.getElementById('ra-launch')) return;
    const launch = el('button', 'ra-launch', '🍽️ RestaurApp');
    launch.title = 'Leer catálogo de WhatsApp';
    launch.addEventListener('click', togglePanel);
    document.body.appendChild(launch);

    const panel = el('div', 'ra-panel');
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="ra-head">
        <strong>Catálogo → RestaurApp</strong>
        <button id="ra-x" title="Cerrar">✕</button>
      </div>
      <div class="ra-actions">
        <button id="ra-scan" class="ra-btn ra-accent">Leer visible</button>
        <button id="ra-click" class="ra-btn">Modo clic: OFF</button>
        <button id="ra-clear" class="ra-btn">Limpiar</button>
      </div>
      <div class="ra-hint">Abrí el catálogo en WhatsApp. "Leer visible" toma los productos en pantalla (scrolleá para cargar más). "Modo clic" te deja tocar productos de a uno.</div>
      <div id="ra-list" class="ra-list"></div>
      <div class="ra-foot">
        <span id="ra-count">0 productos</span>
        <button id="ra-csv" class="ra-btn ra-accent">Descargar CSV</button>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector('#ra-x').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.querySelector('#ra-scan').addEventListener('click', scanVisible);
    panel.querySelector('#ra-click').addEventListener('click', toggleClickMode);
    panel.querySelector('#ra-clear').addEventListener('click', () => { captured = []; renderList(); });
    panel.querySelector('#ra-csv').addEventListener('click', downloadCSV);
    renderList();
  }

  function togglePanel() {
    ui();
    const p = document.getElementById('ra-panel');
    p.style.display = p.style.display === 'none' ? 'flex' : 'none';
  }

  function el(tag, id, text) {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (text) e.textContent = text;
    return e;
  }

  /* ---------- Lectura ---------- */
  // Devuelve la "tarjeta" de producto que contiene a un nodo de precio.
  function cardFor(priceEl) {
    let node = priceEl;
    for (let i = 0; i < 8 && node && node.parentElement; i += 1) {
      node = node.parentElement;
      const txt = (node.innerText || '').trim();
      // una tarjeta razonable: tiene el precio + algo más (el nombre), y no es enorme
      if (txt.length > 0 && txt.length < 400 && txt.split(/\n/).filter((l) => l.trim()).length >= 2) {
        return node;
      }
    }
    return priceEl.parentElement;
  }

  // Extrae { name, price, desc } de una tarjeta usando el texto renderizado.
  function parseCard(card) {
    const lines = (card.innerText || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const priceLine = lines.find((l) => PRICE_RE.test(l) && l.length < 30);
    const price = priceLine ? onlyNumber(priceLine.match(PRICE_RE)[0]) : NaN;
    // nombre: primera línea que no sea el precio ni texto de UI común
    const ignore = /^(agregar|ver|añadir|add|message|mensaje|pedir|comprar|disponible)/i;
    const name = lines.find((l) => l !== priceLine && !PRICE_RE.test(l) && !ignore.test(l) && l.length > 1);
    if (!name || !Number.isFinite(price) || price <= 0) return null;
    const desc = lines.filter((l) => l !== name && l !== priceLine && !ignore.test(l)).join(' ').slice(0, 280);
    return { name, price, desc, category: '' };
  }

  function addItem(item) {
    if (!item) return false;
    const key = item.name.toLowerCase().trim();
    if (captured.some((x) => x.name.toLowerCase().trim() === key)) return false; // sin duplicados
    captured.push(item);
    return true;
  }

  function scanVisible() {
    const seen = new Set();
    let added = 0;
    // Candidatos: elementos cuyo texto directo parece un precio.
    document.querySelectorAll('div,span,p').forEach((node) => {
      const t = (node.textContent || '').trim();
      if (t.length > 30 || !PRICE_RE.test(t)) return;
      const card = cardFor(node);
      if (!card || seen.has(card)) return;
      seen.add(card);
      if (addItem(parseCard(card))) added += 1;
    });
    renderList();
    flash(added ? `Detecté ${added} producto(s) nuevo(s)` : 'No detecté productos nuevos (probá "Modo clic")');
  }

  function toggleClickMode() {
    clickMode = !clickMode;
    const btn = document.getElementById('ra-click');
    btn.textContent = `Modo clic: ${clickMode ? 'ON' : 'OFF'}`;
    btn.classList.toggle('ra-accent', clickMode);
    document.body.style.cursor = clickMode ? 'crosshair' : '';
    if (clickMode && !clickHandler) {
      clickHandler = (e) => {
        if (e.target.closest('#ra-panel') || e.target.closest('#ra-launch')) return; // no capturar la UI
        e.preventDefault(); e.stopPropagation();
        const priceEl = findPriceWithin(e.target) || e.target;
        const card = cardFor(priceEl);
        const ok = addItem(parseCard(card));
        renderList();
        flash(ok ? 'Producto agregado' : 'No pude leer ese (o ya estaba)');
      };
      document.addEventListener('click', clickHandler, true);
    } else if (!clickMode && clickHandler) {
      document.removeEventListener('click', clickHandler, true);
      clickHandler = null;
    }
  }

  function findPriceWithin(node) {
    const card = node.closest ? node.closest('div') : null;
    if (!card) return null;
    const els = card.querySelectorAll('div,span,p');
    for (const e of els) { const t = (e.textContent || '').trim(); if (t.length < 30 && PRICE_RE.test(t)) return e; }
    return PRICE_RE.test((card.textContent || '')) ? card : null;
  }

  /* ---------- Lista + CSV ---------- */
  function renderList() {
    const list = document.getElementById('ra-list');
    if (!list) return;
    list.innerHTML = captured.length
      ? captured.map((it, i) => `
        <div class="ra-item">
          <input class="ra-in ra-name" data-i="${i}" data-k="name" value="${esc(it.name)}" placeholder="Nombre" />
          <input class="ra-in ra-price" data-i="${i}" data-k="price" value="${it.price}" placeholder="Precio" />
          <input class="ra-in ra-cat" data-i="${i}" data-k="category" value="${esc(it.category || '')}" placeholder="Categoría" />
          <button class="ra-del" data-i="${i}" title="Quitar">✕</button>
        </div>`).join('')
      : '<div class="ra-empty">Sin productos todavía.</div>';
    list.querySelectorAll('.ra-in').forEach((inp) => inp.addEventListener('input', () => {
      const it = captured[Number(inp.dataset.i)];
      if (it) it[inp.dataset.k] = inp.dataset.k === 'price' ? onlyNumber(inp.value) : inp.value;
    }));
    list.querySelectorAll('.ra-del').forEach((b) => b.addEventListener('click', () => {
      captured.splice(Number(b.dataset.i), 1); renderList();
    }));
    const c = document.getElementById('ra-count');
    if (c) c.textContent = `${captured.length} producto${captured.length === 1 ? '' : 's'}`;
  }

  function downloadCSV() {
    const valid = captured.filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);
    if (!valid.length) { flash('No hay productos válidos para exportar'); return; }
    const cell = (s) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const rows = ['nombre,precio,categoria,descripcion'];
    for (const it of valid) rows.push([cell(it.name), it.price, cell(it.category || ''), cell(it.desc || '')].join(','));
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `catalogo-whatsapp-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    flash(`CSV con ${valid.length} producto(s) descargado`);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
  let flashTimer = null;
  function flash(msg) {
    let f = document.getElementById('ra-flash');
    if (!f) { f = el('div', 'ra-flash'); document.body.appendChild(f); }
    f.textContent = msg; f.style.opacity = '1';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { f.style.opacity = '0'; }, 2500);
  }

  // El launcher puede tardar en aparecer si WhatsApp aún no cargó el DOM.
  const boot = setInterval(() => { if (document.body) { clearInterval(boot); ui(); } }, 800);
})();
