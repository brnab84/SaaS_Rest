import { applyTheme, getTheme, renderThemePicker } from './themes.js';
import { login, register, getAuthConfig, logout, isAuthed } from './api.js';
import { renderResumen, renderMenu, renderPedidos, renderGastos, renderAjustes } from './views.js';

const root = document.getElementById('root');

const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  resumen: I('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  menu: I('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  pedidos: I('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>'),
  gastos: I('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 14h.5"/>'),
  ajustes: I('<circle cx="12" cy="12" r="3"/><path d="M20 12a8 8 0 0 0-.13-1.4l2-1.5-2-3.5-2.3 1a8 8 0 0 0-2.4-1.4L14.8 2h-4l-.4 2.8a8 8 0 0 0-2.4 1.4l-2.3-1-2 3.5 2 1.5A8 8 0 0 0 4 12c0 .47.05.94.13 1.4l-2 1.5 2 3.5 2.3-1a8 8 0 0 0 2.4 1.4l.4 2.8h4l.4-2.8a8 8 0 0 0 2.4-1.4l2.3 1 2-3.5-2-1.5c.08-.46.13-.93.13-1.4z"/>'),
};
const NAV = [
  { id: 'resumen', label: 'Resumen', view: renderResumen },
  { id: 'menu', label: 'Menú', view: renderMenu },
  { id: 'pedidos', label: 'Pedidos', view: renderPedidos },
  { id: 'gastos', label: 'Gastos', view: renderGastos },
  { id: 'ajustes', label: 'Ajustes', view: renderAjustes },
];

applyTheme(getTheme());
registerSW();
window.addEventListener('hashchange', onRoute);
start();

function start() { isAuthed() ? renderApp() : renderLogin(); }
function currentRoute() { const h = location.hash.replace('#/', ''); return NAV.some((n) => n.id === h) ? h : 'resumen'; }

function mountPicker() {
  const slot = document.getElementById('theme-slot');
  if (slot) renderThemePicker(slot);
  renderVersion();
}

async function renderVersion() {
  let txt = '';
  try { const r = await fetch('/api/version'); const v = await r.json(); txt = `v${v.version} · ${v.commit}`; } catch {}
  const host = document.querySelector('.login') || document.querySelector('.shell');
  if (!host) return;
  let el = host.querySelector('.app-version');
  if (!el) { el = document.createElement('div'); el.className = 'app-version'; host.appendChild(el); }
  el.textContent = txt;
}

/* ---------- Shell autenticado + router ---------- */
function renderApp() {
  const tabs = (cls) => NAV.map((n) => `<a class="${cls}" href="#/${n.id}" data-nav="${n.id}"><span class="nav-ico">${ICONS[n.id]}</span><span class="nav-lbl">${n.label}</span></a>`).join('');
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <span class="brand">RestaurApp<span class="dot">.</span></span>
        <div class="spacer"></div>
        <div id="theme-slot"></div>
        <button class="btn btn-sm" id="logout">Salir</button>
      </header>
      <nav class="tabs">${tabs('tab')}</nav>
      <main class="content" id="view"></main>
      <nav class="bottom-nav">${tabs('bnav')}</nav>
    </div>`;
  mountPicker();
  document.getElementById('logout').addEventListener('click', () => { logout(); location.hash = ''; renderLogin(); });
  onRoute();
}

function onRoute() {
  if (!isAuthed()) { renderLogin(); return; }
  if (!document.getElementById('view')) { renderApp(); return; }
  const id = currentRoute();
  document.querySelectorAll('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === id ? 'page' : 'false'));
  const entry = NAV.find((n) => n.id === id);
  entry.view(document.getElementById('view'));
}

/* ---------- Login ---------- */
function renderLogin() {
  root.innerHTML = `
    <div class="app">
      <div class="login-wrap">
        <form class="login" id="login-form">
          <h1>RestaurApp<span style="color:var(--accent)">.</span></h1>
          <p class="muted" style="font-size:13px;margin:4px 0 0">Panel del comercio</p>
          <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="username" required /></div>
          <div class="field"><label for="password">Contraseña</label><input class="input" id="password" type="password" autocomplete="current-password" required /></div>
          <div class="error" id="login-error"></div>
          <button class="btn btn-accent btn-block" type="submit" id="login-btn">Entrar</button>
          <div class="hint" id="signup-hint" style="display:none">¿Todavía no tenés cuenta? <a href="#" id="to-signup">Creá tu comercio</a>.</div>
          <div class="hint">Probá los temas con los colores de arriba.</div>
          <div style="margin-top:16px" id="theme-slot"></div>
        </form>
      </div>
    </div>`;
  mountPicker();
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn'); const err = document.getElementById('login-error');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Entrando…';
    try { await login(document.getElementById('email').value.trim(), document.getElementById('password').value); location.hash = '#/resumen'; renderApp(); }
    catch (ex) { err.textContent = ex.message || 'No se pudo iniciar sesión'; btn.disabled = false; btn.textContent = 'Entrar'; }
  });
  getAuthConfig().then((cfg) => {
    if (!cfg.registrationOpen) return;
    const hint = document.getElementById('signup-hint'); if (!hint) return;
    hint.style.display = '';
    document.getElementById('to-signup').addEventListener('click', (e) => { e.preventDefault(); renderSignup(); });
  });
}

/* ---------- Crear cuenta ---------- */
function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function renderSignup() {
  root.innerHTML = `
    <div class="app">
      <div class="login-wrap">
        <form class="login" id="signup-form">
          <h1>Creá tu comercio</h1>
          <p class="muted" style="font-size:13px;margin:4px 0 0">Empezá a recibir y gestionar pedidos.</p>
          <div class="field"><label for="biz">Nombre del comercio</label><input class="input" id="biz" type="text" required /></div>
          <div class="field"><label for="slug">Dirección de tu landing (slug)</label><input class="input mono" id="slug" type="text" pattern="[a-z0-9-]+" required /></div>
          <div class="field"><label for="su-email">Email</label><input class="input" id="su-email" type="email" autocomplete="email" required /></div>
          <div class="field"><label for="su-pass">Contraseña (mín. 8)</label><input class="input" id="su-pass" type="password" minlength="8" autocomplete="new-password" required /></div>
          <div class="error" id="signup-error"></div>
          <button class="btn btn-accent btn-block" type="submit" id="signup-btn">Crear cuenta</button>
          <div class="hint">¿Ya tenés cuenta? <a href="#" id="to-login">Iniciá sesión</a>.</div>
          <div style="margin-top:16px" id="theme-slot"></div>
        </form>
      </div>
    </div>`;
  mountPicker();
  const biz = document.getElementById('biz'); const slug = document.getElementById('slug');
  let slugEdited = false;
  slug.addEventListener('input', () => { slugEdited = true; });
  biz.addEventListener('input', () => { if (!slugEdited) slug.value = slugify(biz.value); });
  document.getElementById('to-login').addEventListener('click', (e) => { e.preventDefault(); renderLogin(); });
  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signup-btn'); const err = document.getElementById('signup-error');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Creando…';
    try {
      await register({ businessName: biz.value.trim(), slug: slugify(slug.value), email: document.getElementById('su-email').value.trim(), password: document.getElementById('su-pass').value });
      location.hash = '#/resumen'; renderApp();
    } catch (ex) { err.textContent = ex.message || 'No se pudo crear la cuenta'; btn.disabled = false; btn.textContent = 'Crear cuenta'; }
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
