// Timers y limpiezas de la vista activa: el router los limpia al cambiar de sección (clearTimers).
let _timers = [];
let _cleanups = [];
export function onInterval(fn, ms) { const id = setInterval(fn, ms); _timers.push(id); return id; }
// Registra una limpieza arbitraria (ej. cerrar un EventSource) que corre al salir de la vista.
export function onCleanup(fn) { if (typeof fn === 'function') _cleanups.push(fn); }
export function clearTimers() {
  _timers.forEach(clearInterval); _timers = [];
  _cleanups.forEach((fn) => { try { fn(); } catch {} }); _cleanups = [];
}

export const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const num = new Intl.NumberFormat('es-AR');
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Aviso flotante efímero.
export function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2600);
}

// Diálogo de confirmación. Devuelve Promise<boolean>.
export function confirmDialog(message, { danger = true } = {}) {
  return new Promise((resolve) => {
    const ov = overlay();
    ov.card.innerHTML = `
      <div class="modal-body"><p style="margin:0 0 4px">${esc(message)}</p></div>
      <div class="modal-footer">
        <button class="btn" data-no>Cancelar</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-accent'}" data-yes>Sí, continuar</button>
      </div>`;
    const close = (v) => { ov.remove(); resolve(v); };
    ov.card.querySelector('[data-no]').onclick = () => close(false);
    ov.card.querySelector('[data-yes]').onclick = () => close(true);
    ov.onBackdrop = () => close(false);
  });
}

// Modal con formulario. fields: [{name,label,type,value,required,options,step,placeholder,help}]
// type: text | number | textarea | select | checkbox. onSubmit(values) puede ser async.
export function formModal({ title, fields, submitLabel = 'Guardar', values = {}, onSubmit }) {
  const ov = overlay();
  const rows = fields.map((f) => fieldHTML(f, values[f.name])).join('');
  ov.card.innerHTML = `
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" aria-label="Cerrar" data-x>✕</button></div>
    <form class="modal-body" id="m-form">${rows}<div class="error" id="m-err"></div></form>
    <div class="modal-footer">
      <button class="btn" type="button" data-cancel>Cancelar</button>
      <button class="btn btn-accent" type="submit" form="m-form" id="m-submit">${esc(submitLabel)}</button>
    </div>`;
  const close = () => ov.remove();
  ov.card.querySelector('[data-x]').onclick = close;
  ov.card.querySelector('[data-cancel]').onclick = close;
  ov.onBackdrop = close;

  ov.card.querySelector('#m-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = ov.card.querySelector('#m-submit');
    const err = ov.card.querySelector('#m-err');
    err.textContent = '';
    const data = {};
    for (const f of fields) {
      const node = ov.card.querySelector(`[name="${f.name}"]`);
      if (!node) continue;
      data[f.name] = f.type === 'checkbox' ? node.checked
        : f.type === 'file' ? (node.files[0] || undefined)
          : f.type === 'number' ? (node.value === '' ? undefined : Number(node.value))
            : node.value.trim();
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try { await onSubmit(data); close(); }
    catch (ex) { err.textContent = ex.message || 'No se pudo guardar'; btn.disabled = false; btn.textContent = submitLabel; }
  });
  return ov;
}

function fieldHTML(f, val) {
  const v = val ?? f.value ?? '';
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'textarea') {
    input = `<textarea class="input" name="${f.name}" ${req} placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    input = `<select class="input" name="${f.name}" ${req}>${opts}</select>`;
  } else if (f.type === 'checkbox') {
    return `<label class="field-check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}/> ${esc(f.label)}</label>`;
  } else if (f.type === 'file') {
    input = `<input class="input" type="file" name="${f.name}" ${f.accept ? `accept="${esc(f.accept)}"` : ''}/>`;
  } else {
    input = `<input class="input" type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${req} ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}"/>`;
  }
  return `<div class="field"><label>${esc(f.label)}</label>${input}${f.help ? `<div class="hint" style="margin-top:4px">${esc(f.help)}</div>` : ''}</div>`;
}

/* ===== Notificaciones de pedidos (sonido + aviso del sistema) ===== */
const SOUND_KEY = 'restaurapp.sound';   // 'on' | 'off' (default on)
const TONE_KEY = 'restaurapp.tone';     // 'campana' | 'timbre' | 'arpa'
const LEVEL_KEY = 'restaurapp.alarm';   // 'slow' | 'medium' | 'strong'
export function soundEnabled() { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } }
export function setSoundEnabled(on) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch {} }
export function getTone() { try { return localStorage.getItem(TONE_KEY) || 'campana'; } catch { return 'campana'; } }
export function setTone(t) { try { localStorage.setItem(TONE_KEY, t); } catch {} }
export function getAlarmLevel() { try { return localStorage.getItem(LEVEL_KEY) || 'medium'; } catch { return 'medium'; } }
export function setAlarmLevel(l) { try { localStorage.setItem(LEVEL_KEY, l); } catch {} }

// Secuencia de notas por tono (frecuencias en Hz).
const TONES = {
  campana: [880, 1320],
  timbre: [1568, 1568],
  arpa: [659, 784, 988],
};
// Intensidad de la alarma: volumen, repeticiones de la secuencia y duración de cada nota.
const LEVELS = {
  slow: { vol: 0.12, reps: 1, dur: 0.30 },
  medium: { vol: 0.30, reps: 2, dur: 0.34 },
  strong: { vol: 0.6, reps: 4, dur: 0.42 },
};

let _audioCtx = null;
// Beep sintetizado con WebAudio: no requiere archivos de audio. force ignora la preferencia (para "Probar").
export function playPing(force = false) {
  if (!force && !soundEnabled()) return;
  try {
    _audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = TONES[getTone()] || TONES.campana;
    const L = LEVELS[getAlarmLevel()] || LEVELS.medium;
    const seqLen = notes.length * 0.16 + 0.22; // separación entre repeticiones
    for (let r = 0; r < L.reps; r += 1) {
      const base = ctx.currentTime + r * seqLen;
      notes.forEach((freq, i) => {
        const t0 = base + i * 0.16;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(L.vol, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + L.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + L.dur + 0.02);
      });
    }
    if (getAlarmLevel() === 'strong') { try { navigator.vibrate && navigator.vibrate([200, 120, 200, 120, 300]); } catch {} }
  } catch {}
}

// Aviso del sistema (si el usuario dio permiso). Best-effort.
export function pushNotify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(title, { body, tag: 'restaurapp-order', renotify: true });
  } catch {}
}
export async function requestNotifyPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch {}
}

/* ===== Comanda / impresión (preferencias por dispositivo) =====
 * Dos métodos parametrizables:
 *  - 'system': ticket 80/58mm impreso con el diálogo del navegador (cualquier impresora).
 *  - 'thermal': impresión directa ESC/POS por Web Serial (Chrome/Edge desktop, sin diálogo).
 */
const C_KEY = 'restaurapp.comanda';
const C_DEF = { on: false, method: 'system', width: '80', auto: false, copies: 1, baud: 9600 };
export function getComanda() { try { return { ...C_DEF, ...(JSON.parse(localStorage.getItem(C_KEY) || '{}')) }; } catch { return { ...C_DEF }; } }
export function setComanda(p) { try { localStorage.setItem(C_KEY, JSON.stringify({ ...getComanda(), ...p })); } catch {} }

const deburr = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// --- Método 'system': ticket HTML para 80/58mm vía iframe + print() ---
function systemTicketHTML(o, businessName, c) {
  const mm = c.width === '58' ? '58mm' : '80mm';
  const rows = (o.items || []).map((i) => `<tr><td class="q">${i.qty}×</td><td>${esc(i.name || '')}</td></tr>`).join('');
  const when = new Date(o.createdAt || Date.now()).toLocaleString('es-AR');
  const cust = [o.customer?.name, o.customer?.phone].filter(Boolean).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${mm} auto; margin: 0; }
    * { font-family: 'Courier New', monospace; }
    body { width: ${mm}; margin: 0; padding: 6px 8px; color: #000; }
    h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
    .sub { text-align: center; font-size: 11px; letter-spacing: 2px; }
    .code { text-align: center; font-size: 22px; font-weight: bold; margin: 6px 0; }
    .meta { font-size: 11px; }
    hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    td { padding: 2px 0; vertical-align: top; } td.q { width: 34px; font-weight: bold; }
    .tot { font-size: 15px; font-weight: bold; text-align: right; margin-top: 8px; }
  </style></head><body>
    <h1>${esc(businessName || 'Comanda')}</h1><div class="sub">COMANDA</div>
    <div class="code">#${esc(o.code || '')}</div>
    <div class="meta">${esc(when)}</div>
    <div class="meta">${esc(o.channel || '')}${cust ? ` · ${esc(cust)}` : ''}</div>
    <hr><table>${rows}</table><hr>
    <div class="tot">TOTAL ${money.format(o.total || 0)}</div>
    ${o.customer?.address ? `<div class="meta">Dir: ${esc(o.customer.address)}</div>` : ''}
  </body></html>`;
}
function systemPrint(html) {
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(ifr);
  const doc = ifr.contentWindow.document; doc.open(); doc.write(html); doc.close();
  const go = () => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch {} setTimeout(() => ifr.remove(), 1500); };
  if (doc.readyState === 'complete') setTimeout(go, 60); else ifr.onload = go;
}

// --- Método 'thermal': ESC/POS por Web Serial ---
let _port = null; let _portOpen = false;
async function ensurePort(pick, baud) {
  if (!('serial' in navigator)) throw new Error('Este navegador no soporta impresión directa. Usá Chrome/Edge de escritorio o el método "Impresora del sistema".');
  if (!_port || pick) {
    if (pick) { _port = await navigator.serial.requestPort(); _portOpen = false; }
    else { const ports = await navigator.serial.getPorts(); if (ports[0]) _port = ports[0]; else _port = await navigator.serial.requestPort(); }
  }
  if (!_portOpen) { await _port.open({ baudRate: Number(baud) || 9600 }); _portOpen = true; }
  return _port;
}
function escposTicket(o, businessName, c) {
  const enc = new TextEncoder(); const out = [];
  const raw = (a) => out.push(...a);
  const txt = (s) => out.push(...enc.encode(deburr(s)));
  const LF = 0x0a; const ESC = 0x1b; const GS = 0x1d;
  raw([ESC, 0x40]);                 // init
  raw([ESC, 0x61, 1]);              // center
  raw([GS, 0x21, 0x11]); txt(businessName || 'Comanda'); raw([GS, 0x21, 0x00], LF);
  txt('COMANDA'); raw([LF]);
  raw([GS, 0x21, 0x11]); txt('#' + (o.code || '')); raw([GS, 0x21, 0x00], LF, LF);
  raw([ESC, 0x61, 0]);             // left
  txt(new Date(o.createdAt || Date.now()).toLocaleString('es-AR')); raw([LF]);
  const cust = [o.customer?.name, o.customer?.phone].filter(Boolean).join(' - ');
  if (o.channel || cust) { txt(`${o.channel || ''}${cust ? ' - ' + cust : ''}`); raw([LF]); }
  txt('--------------------------------'); raw([LF]);
  for (const i of (o.items || [])) { txt(`${i.qty}x ${i.name || ''}`); raw([LF]); }
  txt('--------------------------------'); raw([LF]);
  raw([ESC, 0x61, 2]);             // right
  raw([GS, 0x21, 0x01]); txt('TOTAL ' + money.format(o.total || 0)); raw([GS, 0x21, 0x00], LF);
  if (o.customer?.address) { raw([ESC, 0x61, 0]); txt('Dir: ' + o.customer.address); raw([LF]); }
  raw([LF, LF, LF]);
  raw([GS, 0x56, 0x42, 0x00]);     // corte parcial
  return new Uint8Array(out);
}
async function thermalPrint(data, baud) {
  const port = await ensurePort(false, baud);
  const w = port.writable.getWriter();
  try { await w.write(data); } finally { w.releaseLock(); }
}

// Imprime una comanda según el método configurado. Lanza error si falla (para avisar).
export async function printComanda(order, businessName) {
  const c = getComanda();
  const copies = Math.max(1, Number(c.copies) || 1);
  for (let i = 0; i < copies; i += 1) {
    if (c.method === 'thermal') await thermalPrint(escposTicket(order, businessName, c), c.baud); // eslint-disable-line no-await-in-loop
    else systemPrint(systemTicketHTML(order, businessName, c));
  }
}
// Conectar la térmica (elige el puerto; el permiso queda guardado para la próxima).
export async function connectThermal() { const c = getComanda(); await ensurePort(true, c.baud); }
// Prueba de impresión (ignora el on/off; usa el método configurado).
export async function testComanda(businessName) {
  const sample = { code: 'PRUEBA', createdAt: Date.now(), channel: 'test', customer: { name: 'Cliente de prueba' }, items: [{ qty: 1, name: 'Item de prueba' }, { qty: 2, name: 'Otro item' }], total: 1234 };
  return printComanda(sample, businessName);
}

// Modal informativo (solo lectura, con HTML confiable provisto por la vista).
export function infoModal({ title, html, closeLabel = 'Cerrar' }) {
  const ov = overlay();
  ov.card.innerHTML = `
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" aria-label="Cerrar" data-x>✕</button></div>
    <div class="modal-body">${html}</div>
    <div class="modal-footer"><button class="btn btn-accent" data-close>${esc(closeLabel)}</button></div>`;
  ov.card.querySelector('[data-x]').onclick = ov.remove;
  ov.card.querySelector('[data-close]').onclick = ov.remove;
  ov.onBackdrop = ov.remove;
  return ov;
}

// Crea el overlay base y devuelve { card, remove, onBackdrop }.
function overlay() {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  const card = document.createElement('div');
  card.className = 'modal';
  ov.appendChild(card);
  document.body.appendChild(ov);
  const ctrl = { card, remove: () => ov.remove(), onBackdrop: null };
  ov.addEventListener('click', (e) => { if (e.target === ov && ctrl.onBackdrop) ctrl.onBackdrop(); });
  requestAnimationFrame(() => ov.classList.add('show'));
  return ctrl;
}
