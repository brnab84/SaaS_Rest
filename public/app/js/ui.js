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
export function soundEnabled() { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } }
export function setSoundEnabled(on) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch {} }
export function getTone() { try { return localStorage.getItem(TONE_KEY) || 'campana'; } catch { return 'campana'; } }
export function setTone(t) { try { localStorage.setItem(TONE_KEY, t); } catch {} }

// Secuencia de notas por tono (frecuencias en Hz).
const TONES = {
  campana: [880, 1320],
  timbre: [1568, 1568],
  arpa: [659, 784, 988],
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
    notes.forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + 0.34);
    });
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
