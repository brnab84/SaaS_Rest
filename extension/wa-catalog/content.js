/* RestaurApp — importador de catálogo de WhatsApp Web (directo a tu sesión).
 * Corre como content script en web.whatsapp.com. Lee los productos del catálogo
 * abierto (todos los visibles con "Leer visible", o de a uno con "Modo clic") y los
 * IMPORTA directo a tu cuenta de RestaurApp: nombre, precio, descripción, categoría
 * e imagen.
 *
 * Autenticación: el "bridge" de la extensión corre en la pestaña de la app y copia
 * tu token de sesión a chrome.storage. Tené la app abierta y logueada en otra pestaña.
 *
 * Nota: WhatsApp Web tiene el HTML ofuscado y cambia seguido; la lectura es heurística
 * (patrón de precio + estructura). Si algún producto no se detecta, usá "Modo clic".
 */
(() => {
  if (window.__raCatalogLoaded) return;
  window.__raCatalogLoaded = true;

  const PRICE_RE = /(?:\$|US\$|u\$s|usd|ars|eur|€|r\$|s\/|bs\.?|₲|gs\.?|g\$|cop|mxn|clp|pen|uyu|bob|pyg)\s*\d[\d.,]*/i;
  const onlyNumber = (s) => Number(String(s || '').replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const API_DEFAULT = 'https://api-production-1cc8.up.railway.app';
  // Líneas "ruido" de la UI de WhatsApp que NO son el nombre del producto.
  const NOISE_RE = /^(agregar|añadir|add to cart|add|ver(\s|$)|ver más|ver mas|message|mensaje|pedir|comprar|disponible|esperando|en l[ií]nea|online|escribiendo|typing|[úu]ltima vez|last seen|cargando|loading|reintentar|conectando|sin conexi[óo]n|detalles|cat[áa]logo|\d{1,2}:\d{2})/i;

  let captured = [];     // [{ name, price, desc, category, imgUrl }]
  let clickMode = false;
  let clickHandler = null;
  let importing = false;

  /* ---------- UI ---------- */
  function ui() {
    if (document.getElementById('ra-launch')) return;
    const launch = el('button', 'ra-launch', '🍽️ RestaurApp');
    launch.title = 'Importar catálogo a RestaurApp';
    launch.addEventListener('click', togglePanel);
    document.body.appendChild(launch);

    const panel = el('div', 'ra-panel');
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="ra-head"><strong>Catálogo → RestaurApp</strong><button id="ra-x" title="Cerrar">✕</button></div>
      <div class="ra-actions">
        <button id="ra-scan" class="ra-btn ra-accent">Leer visible</button>
        <button id="ra-click" class="ra-btn">Modo clic: OFF</button>
        <button id="ra-clear" class="ra-btn">Limpiar</button>
      </div>
      <div class="ra-hint">Abrí el catálogo en WhatsApp. "Leer visible" toma los productos en pantalla (scrolleá para cargar más). "Modo clic" te deja tocar productos de a uno. Tené la app RestaurApp abierta y logueada en otra pestaña.</div>
      <div id="ra-status" class="ra-status"></div>
      <div class="ra-manual-row"><a id="ra-manual-toggle" href="#">¿No conecta? Pegar token manual</a></div>
      <div id="ra-manual" class="ra-manual" style="display:none">
        <input id="ra-token-in" class="ra-in" placeholder="Pegá tu token (Menú → Extensión → Copiar token)" />
        <button id="ra-token-save" class="ra-btn ra-accent">Guardar token</button>
      </div>
      <div id="ra-list" class="ra-list"></div>
      <div class="ra-foot">
        <span id="ra-count">0 productos</span>
        <button id="ra-import" class="ra-btn ra-accent">Importar a RestaurApp</button>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector('#ra-x').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.querySelector('#ra-scan').addEventListener('click', scanVisible);
    panel.querySelector('#ra-click').addEventListener('click', toggleClickMode);
    panel.querySelector('#ra-clear').addEventListener('click', () => { captured = []; renderList(); });
    panel.querySelector('#ra-import').addEventListener('click', importAll);
    panel.querySelector('#ra-manual-toggle').addEventListener('click', (e) => {
      e.preventDefault();
      const m = panel.querySelector('#ra-manual');
      m.style.display = m.style.display === 'none' ? 'flex' : 'none';
    });
    panel.querySelector('#ra-token-save').addEventListener('click', async () => {
      const val = (panel.querySelector('#ra-token-in').value || '').trim();
      if (!val) return;
      try { await chrome.storage.local.set({ ra_token: val, ra_api: API_DEFAULT }); } catch {}
      panel.querySelector('#ra-manual').style.display = 'none';
      flash('Token guardado');
      checkSession();
    });
    renderList();
    checkSession();
    // Reactivo: cuando el bridge (pestaña de la app) escribe el token, actualizamos el estado.
    try { chrome.storage.onChanged.addListener((c, area) => { if (area === 'local') checkSession(); }); } catch {}
    setInterval(checkSession, 4000);
  }

  function togglePanel() {
    ui();
    const p = document.getElementById('ra-panel');
    p.style.display = p.style.display === 'none' ? 'flex' : 'none';
    if (p.style.display === 'flex') checkSession();
  }

  function el(tag, id, text) { const e = document.createElement(tag); if (id) e.id = id; if (text) e.textContent = text; return e; }

  async function session() {
    try { return await chrome.storage.local.get(['ra_token', 'ra_api']); } catch { return {}; }
  }
  async function checkSession() {
    const s = await session();
    const st = document.getElementById('ra-status');
    if (!st) return;
    if (s.ra_token) { st.textContent = `Conectado a tu sesión (${s.ra_api || ''})`; st.className = 'ra-status ok'; }
    else { st.textContent = '⚠ Abrí RestaurApp y logueate en otra pestaña para conectar tu sesión.'; st.className = 'ra-status warn'; }
  }

  /* ---------- Lectura ---------- */
  function cardFor(priceEl) {
    let node = priceEl;
    for (let i = 0; i < 8 && node && node.parentElement; i += 1) {
      node = node.parentElement;
      const txt = (node.innerText || '').trim();
      if (txt.length > 0 && txt.length < 400 && txt.split(/\n/).filter((l) => l.trim()).length >= 2) return node;
    }
    return priceEl.parentElement;
  }

  function parseCard(card) {
    const lines = (card.innerText || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const priceLine = lines.find((l) => PRICE_RE.test(l) && l.length < 30);
    const price = priceLine ? onlyNumber(priceLine.match(PRICE_RE)[0]) : NaN;
    const name = lines.find((l) => l !== priceLine && !PRICE_RE.test(l) && !NOISE_RE.test(l) && l.length > 1 && l.length <= 60);
    if (!name || !Number.isFinite(price) || price <= 0) return null;
    const desc = lines.filter((l) => l !== name && l !== priceLine && !NOISE_RE.test(l)).join(' ').slice(0, 280);
    const img = card.querySelector('img');
    return { name, price, desc, category: '', imgUrl: img && img.src ? img.src : '' };
  }

  function addItem(item) {
    if (!item) return false;
    const key = item.name.toLowerCase().trim();
    if (captured.some((x) => x.name.toLowerCase().trim() === key)) return false;
    captured.push(item);
    return true;
  }

  function scanVisible() {
    const seen = new Set();
    let added = 0;
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
        if (e.target.closest('#ra-panel') || e.target.closest('#ra-launch')) return;
        e.preventDefault(); e.stopPropagation();
        const priceEl = findPriceWithin(e.target) || e.target;
        const ok = addItem(parseCard(cardFor(priceEl)));
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
    for (const e of card.querySelectorAll('div,span,p')) {
      const t = (e.textContent || '').trim();
      if (t.length < 30 && PRICE_RE.test(t)) return e;
    }
    return PRICE_RE.test((card.textContent || '')) ? card : null;
  }

  /* ---------- Lista ---------- */
  function renderList() {
    const list = document.getElementById('ra-list');
    if (!list) return;
    list.innerHTML = captured.length
      ? captured.map((it, i) => `
        <div class="ra-item">
          ${it.imgUrl ? `<img class="ra-thumb" src="${it.imgUrl}" />` : '<span class="ra-thumb ra-noimg">—</span>'}
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
    list.querySelectorAll('.ra-del').forEach((b) => b.addEventListener('click', () => { captured.splice(Number(b.dataset.i), 1); renderList(); }));
    const c = document.getElementById('ra-count');
    if (c) c.textContent = `${captured.length} producto${captured.length === 1 ? '' : 's'}`;
  }

  /* ---------- Importar directo a RestaurApp ---------- */
  async function importAll() {
    if (importing) return;
    const valid = captured.filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);
    if (!valid.length) { flash('No hay productos válidos'); return; }
    const { ra_token: token, ra_api: apiBase } = await session();
    if (!token || !apiBase) { setStatus('⚠ No encuentro tu sesión. Abrí RestaurApp y logueate en otra pestaña.', 'warn'); return; }

    importing = true;
    let ok = 0; let fail = 0;
    for (let i = 0; i < valid.length; i += 1) {
      const it = valid[i];
      setStatus(`Importando ${i + 1}/${valid.length}: ${it.name}…`, 'ok');
      try {
        let photo = '';
        if (it.imgUrl) { try { photo = await uploadImage(apiBase, token, it.imgUrl, it.name); } catch { /* sin foto */ } }
        await createProduct(apiBase, token, it, photo);
        ok += 1;
      } catch (e) {
        fail += 1;
        if (String(e.message || '').includes('límite')) { setStatus(`Frenado: ${e.message}`, 'warn'); break; }
      }
    }
    importing = false;
    setStatus(`Listo: ${ok} importado(s)${fail ? `, ${fail} con error` : ''}. Revisá tu Menú en RestaurApp.`, ok ? 'ok' : 'warn');
    flash(`${ok} producto(s) importado(s)`);
  }

  async function createProduct(apiBase, token, it, photo) {
    const res = await fetch(`${apiBase}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: it.name, price: it.price, description: it.desc || undefined, category: it.category || undefined, photo: photo || undefined, available: true }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error?.message || `Error ${res.status}`); }
    return res.json();
  }

  async function uploadImage(apiBase, token, url, name) {
    const blob = await imgToBlob(url);
    if (!blob) throw new Error('sin imagen');
    const fd = new FormData();
    fd.append('file', blob, `${(name || 'foto').replace(/[^\w]+/g, '-').slice(0, 40)}.jpg`);
    const res = await fetch(`${apiBase}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    const d = await res.json();
    return d.url;
  }

  // Obtiene el binario de la imagen: intenta fetch directo y si falla, vía canvas.
  async function imgToBlob(url) {
    try { const r = await fetch(url); if (r.ok) { const b = await r.blob(); if (b && b.size) return b; } } catch { /* sigue con canvas */ }
    return new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth || 600; c.height = im.naturalHeight || 600;
          c.getContext('2d').drawImage(im, 0, 0);
          c.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
        } catch { resolve(null); }
      };
      im.onerror = () => resolve(null);
      im.src = url;
    });
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
  function setStatus(msg, kind) { const st = document.getElementById('ra-status'); if (st) { st.textContent = msg; st.className = `ra-status ${kind || ''}`; } }
  let flashTimer = null;
  function flash(msg) {
    let f = document.getElementById('ra-flash');
    if (!f) { f = el('div', 'ra-flash'); document.body.appendChild(f); }
    f.textContent = msg; f.style.opacity = '1';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { f.style.opacity = '0'; }, 2500);
  }

  const boot = setInterval(() => { if (document.body) { clearInterval(boot); ui(); } }, 800);
})();
