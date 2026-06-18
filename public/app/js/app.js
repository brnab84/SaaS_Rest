import { applyTheme, getTheme, renderThemePicker, setThemeChangeHandler } from './themes.js';
import { login, register, getAuthConfig, logout, isAuthed, tenantApi, me } from './api.js';
import { renderResumen, renderMenu, renderPedidos, renderGastos, renderCampanias, renderAjustes, renderAdmin } from './views.js';
import { clearTimers, esc } from './ui.js';

const root = document.getElementById('root');

const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  resumen: I('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  menu: I('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  pedidos: I('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>'),
  gastos: I('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 14h.5"/>'),
  campanias: I('<path d="M3 10v4h3l8 4V6L6 10H3z"/><path d="M17 9a3 3 0 0 1 0 6"/>'),
  ajustes: I('<circle cx="12" cy="12" r="3"/><path d="M20 12a8 8 0 0 0-.13-1.4l2-1.5-2-3.5-2.3 1a8 8 0 0 0-2.4-1.4L14.8 2h-4l-.4 2.8a8 8 0 0 0-2.4 1.4l-2.3-1-2 3.5 2 1.5A8 8 0 0 0 4 12c0 .47.05.94.13 1.4l-2 1.5 2 3.5 2.3-1a8 8 0 0 0 2.4 1.4l.4 2.8h4l.4-2.8a8 8 0 0 0 2.4-1.4l2.3 1 2-3.5-2-1.5c.08-.46.13-.93.13-1.4z"/>'),
  admin: I('<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>'),
};
const NAV = [
  { id: 'resumen', label: 'Resumen', view: renderResumen },
  { id: 'menu', label: 'Menú', view: renderMenu },
  { id: 'pedidos', label: 'Pedidos', view: renderPedidos },
  { id: 'gastos', label: 'Gastos', view: renderGastos },
  { id: 'campanias', label: 'Campañas', view: renderCampanias },
  { id: 'ajustes', label: 'Ajustes', view: renderAjustes },
];
const ADMIN_NAV = { id: 'admin', label: 'Admin', view: renderAdmin };
let rootUser = false; // ¿la cuenta logueada es el dueño de la app? Habilita la pestaña Admin.
let brandTenant = null; // si el plan tiene marca blanca, mostramos el logo/nombre del comercio
const navItems = () => (rootUser ? [...NAV, ADMIN_NAV] : NAV);
// Marca del topbar: por defecto "RestaurApp."; con marca blanca, logo+nombre del comercio.
function brandHtml() {
  if (brandTenant?.whitelabel) {
    const b = brandTenant.branding || {};
    const logo = b.logo ? `<img class="brand-logo" src="${esc(b.logo)}" alt="" />` : '';
    return `${logo}<span class="brand-name">${esc(brandTenant.name)}</span>`;
  }
  return 'RestaurApp<span class="dot">.</span>';
}

applyTheme(getTheme());
// Al cambiar el tema, persistirlo en el comercio (así la landing usa el mismo).
setThemeChangeHandler((id) => { if (isAuthed()) tenantApi.update({ branding: { theme: id } }).catch(() => {}); });
registerSW();
window.addEventListener('hashchange', onRoute);
start();
syncTenantTheme();
setupAutoUpdate();

/* ---------- Auto-actualización: forzar la última versión ---------- */
let bootVer = null;
async function checkVersion() {
  try {
    const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version;
    if (bootVer && v && v !== bootVer) showUpdateBanner();
    if (!bootVer) bootVer = v;
  } catch {}
}
function setupAutoUpdate() {
  // Al entrar ya recibís la última versión (el SW es network-first). Durante el uso,
  // si entra un deploy nuevo, mostramos un cartel para actualizar sin cortarte.
  checkVersion();
  setInterval(checkVersion, 60000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(); });
      });
    }).catch(() => {});
  }
}
function showUpdateBanner() {
  if (document.getElementById('upd-banner')) return;
  const b = document.createElement('div');
  b.id = 'upd-banner'; b.className = 'upd-banner';
  b.innerHTML = '⬆ Hay una versión nueva de la app. <button id="upd-go">Actualizar</button>';
  document.body.appendChild(b);
  document.getElementById('upd-go').addEventListener('click', async () => {
    try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
    location.reload();
  });
}

// Aplica el tema guardado en el comercio (si el usuario lo cambió desde otro dispositivo).
function syncTenantTheme() {
  if (!isAuthed()) return;
  tenantApi.get().then((t) => {
    if (t.branding?.theme && t.branding.theme !== getTheme()) {
      applyTheme(t.branding.theme);
      const slot = document.getElementById('theme-slot');
      if (slot) renderThemePicker(slot);
    }
  }).catch(() => {});
}

function start() {
  if (!isAuthed()) { renderLogin(); return; }
  renderApp();
  detectRoot(); // asíncrono: si la cuenta es root, agrega la pestaña Admin
}

// Detecta root (pestaña Admin) y marca blanca (logo propio en el topbar); re-renderiza si aplica.
async function detectRoot() {
  let m;
  try { m = await me(); } catch { return; }
  rootUser = !!m.user?.isRoot;
  if (m.tenant?.whitelabel) brandTenant = m.tenant;
  if ((rootUser || brandTenant) && document.getElementById('view')) renderApp();
}

function currentRoute() { const h = location.hash.replace('#/', ''); return navItems().some((n) => n.id === h) ? h : 'resumen'; }

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
  const tabs = (cls) => navItems().map((n) => `<a class="${cls}" href="#/${n.id}" data-nav="${n.id}"><span class="nav-ico">${ICONS[n.id]}</span><span class="nav-lbl">${n.label}</span></a>`).join('');
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <span class="brand">${brandHtml()}</span>
        <div class="spacer"></div>
        <button class="btn btn-sm" id="logout">Salir</button>
      </header>
      <nav class="tabs">${tabs('tab')}</nav>
      <main class="content" id="view"></main>
      <nav class="bottom-nav">${tabs('bnav')}</nav>
    </div>`;
  mountPicker();
  document.getElementById('logout').addEventListener('click', () => { clearTimers(); logout(); location.hash = ''; renderLogin(); });
  onRoute();
}

function onRoute() {
  if (!isAuthed()) { renderLogin(); return; }
  if (!document.getElementById('view')) { renderApp(); return; }
  clearTimers(); // detener auto-refresco de la vista anterior
  const id = currentRoute();
  document.querySelectorAll('[data-nav]').forEach((a) => a.setAttribute('aria-current', a.dataset.nav === id ? 'page' : 'false'));
  const entry = navItems().find((n) => n.id === id);
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
          <div class="field"><label for="slug">Dirección de tu landing</label><input class="input mono" id="slug" type="text" pattern="[a-z0-9-]+" required readonly aria-readonly="true" /><div class="hint" id="slug-hint" style="margin-top:4px">Se genera automáticamente del nombre del comercio.</div></div>
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
  const biz = document.getElementById('biz'); const slug = document.getElementById('slug'); const slugHint = document.getElementById('slug-hint');
  // El slug es solo lectura: siempre se deriva del nombre del comercio.
  biz.addEventListener('input', () => {
    slug.value = slugify(biz.value);
    if (slugHint) slugHint.textContent = slug.value ? `${location.origin}/r/${slug.value}` : 'Se genera automáticamente del nombre del comercio.';
  });
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
