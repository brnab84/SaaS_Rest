import { applyTheme, getTheme, renderThemePicker } from './themes.js';
import { api, login, register, getAuthConfig, logout, isAuthed } from './api.js';

const root = document.getElementById('root');

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-AR');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CAT_ES = { supplies: 'Insumos', rent: 'Alquiler', salary: 'Sueldos', utilities: 'Servicios', other: 'Otros' };

applyTheme(getTheme());
registerSW();
route();

function route() {
  if (isAuthed()) renderDashboard();
  else renderLogin();
}

function mountPicker() {
  const slot = document.getElementById('theme-slot');
  if (slot) renderThemePicker(slot);
  renderVersion();
}

// Footer de versión: semver (package.json) + commit de git, vía /api/version.
async function renderVersion() {
  let txt = '';
  try {
    const r = await fetch('/api/version');
    const v = await r.json();
    txt = `v${v.version} · ${v.commit}`;
  } catch {}
  const host = document.querySelector('.login') || document.querySelector('.app');
  if (!host) return;
  let el = host.querySelector('.app-version');
  if (!el) { el = document.createElement('div'); el.className = 'app-version'; host.appendChild(el); }
  el.textContent = txt;
}

/* ---------- Login ---------- */
function renderLogin() {
  root.innerHTML = `
    <div class="app">
      <div class="login-wrap">
        <form class="login" id="login-form">
          <h1>RestaurApp<span style="color:var(--accent)">.</span></h1>
          <p class="muted" style="font-size:13px;margin:4px 0 0">Panel del comercio</p>
          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" type="email" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="password">Contraseña</label>
            <input class="input" id="password" type="password" autocomplete="current-password" required />
          </div>
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
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await login(document.getElementById('email').value.trim(), document.getElementById('password').value);
      renderDashboard();
    } catch (ex) {
      err.textContent = ex.message || 'No se pudo iniciar sesión';
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
  // Mostrar "crear cuenta" solo si el admin tiene el registro abierto.
  getAuthConfig().then((cfg) => {
    if (!cfg.registrationOpen) return;
    const hint = document.getElementById('signup-hint');
    if (!hint) return;
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
          <div class="field">
            <label for="biz">Nombre del comercio</label>
            <input class="input" id="biz" type="text" required />
          </div>
          <div class="field">
            <label for="slug">Dirección de tu landing (slug)</label>
            <input class="input mono" id="slug" type="text" pattern="[a-z0-9-]+" required />
          </div>
          <div class="field">
            <label for="su-email">Email</label>
            <input class="input" id="su-email" type="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="su-pass">Contraseña (mín. 8)</label>
            <input class="input" id="su-pass" type="password" minlength="8" autocomplete="new-password" required />
          </div>
          <div class="error" id="signup-error"></div>
          <button class="btn btn-accent btn-block" type="submit" id="signup-btn">Crear cuenta</button>
          <div class="hint">¿Ya tenés cuenta? <a href="#" id="to-login">Iniciá sesión</a>.</div>
          <div style="margin-top:16px" id="theme-slot"></div>
        </form>
      </div>
    </div>`;
  mountPicker();

  const biz = document.getElementById('biz');
  const slug = document.getElementById('slug');
  let slugEdited = false;
  slug.addEventListener('input', () => { slugEdited = true; });
  biz.addEventListener('input', () => { if (!slugEdited) slug.value = slugify(biz.value); });

  document.getElementById('to-login').addEventListener('click', (e) => { e.preventDefault(); renderLogin(); });

  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signup-btn');
    const err = document.getElementById('signup-error');
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      await register({
        businessName: biz.value.trim(),
        slug: slugify(slug.value),
        email: document.getElementById('su-email').value.trim(),
        password: document.getElementById('su-pass').value,
      });
      renderDashboard();
    } catch (ex) {
      err.textContent = ex.message || 'No se pudo crear la cuenta';
      btn.disabled = false; btn.textContent = 'Crear cuenta';
    }
  });
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <span class="brand">RestaurApp<span class="dot">.</span></span>
        <div class="spacer"></div>
        <div id="theme-slot"></div>
        <button class="btn" id="logout-btn">Salir</button>
      </header>

      <div class="section-title"><h2>Resumen · últimos 30 días</h2></div>
      <div id="kpis" class="kpi-grid"><div class="spinner">Cargando…</div></div>

      <div class="panel-grid">
        <div class="panel"><h2>Ventas por día</h2><div id="sales">—</div></div>
        <div class="panel"><h2>Gastos por categoría</h2><div id="expenses">—</div></div>
      </div>

      <div class="panel"><h2>Productos más vendidos</h2><div id="products">—</div></div>

      <div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <h2>Pronóstico de ventas (IA)</h2>
          <button class="btn btn-accent" id="forecast-btn">Proyectar 7 días</button>
        </div>
        <div id="forecast" style="margin-top:12px"></div>
      </div>
    </div>`;
  mountPicker();
  document.getElementById('logout-btn').addEventListener('click', () => { logout(); renderLogin(); });
  document.getElementById('forecast-btn').addEventListener('click', loadForecast);
  loadData();
}

async function loadData() {
  const [summary, sales, expenses, products] = await Promise.allSettled([
    api.summary(), api.sales(), api.expenses(), api.products(),
  ]);
  renderKpis(summary);
  renderSales(sales);
  renderExpenses(expenses);
  renderProducts(products);
}

function renderKpis(r) {
  const box = document.getElementById('kpis');
  if (r.status !== 'fulfilled') { box.innerHTML = `<div class="empty">No se pudo cargar el resumen.</div>`; return; }
  const s = r.value;
  const profit = s.grossProfit ?? (s.revenue - s.expenses);
  const card = (label, value, extra = '') => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${extra}</div>`;
  box.innerHTML =
    card('Ventas', money.format(s.revenue || 0)) +
    card('Pedidos', num.format(s.orders || 0)) +
    card('Ticket promedio', money.format(s.avgTicket || 0)) +
    card('Gastos', money.format(s.expenses || 0)) +
    card('Ganancia bruta', money.format(profit || 0),
      `<div class="delta ${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '▲' : '▼'} margen</div>`);
}

function renderSales(r) {
  const box = document.getElementById('sales');
  if (r.status !== 'fulfilled' || !r.value.length) { box.innerHTML = `<div class="empty">Todavía no hay ventas pagadas en el período.</div>`; return; }
  const data = r.value.slice(-14);
  const max = Math.max(...data.map((d) => d.revenue), 1);
  box.innerHTML = `<div class="bars">${data.map((d) => {
    const h = Math.round((d.revenue / max) * 100);
    const day = d.date.slice(8, 10);
    return `<div class="col" title="${esc(d.date)}: ${money.format(d.revenue)}"><div class="bar" style="height:${h}%"></div><div class="tick">${day}</div></div>`;
  }).join('')}</div>`;
}

function renderExpenses(r) {
  const box = document.getElementById('expenses');
  if (r.status !== 'fulfilled' || !r.value.length) { box.innerHTML = `<div class="empty">Sin gastos cargados en el período.</div>`; return; }
  const max = Math.max(...r.value.map((e) => e.total), 1);
  box.innerHTML = `<div class="rows">${r.value.map((e) => `
    <div class="row">
      <span class="name">${esc(CAT_ES[e.category] || e.category || 'Otros')}</span>
      <span class="amt">${money.format(e.total)}</span>
      <div class="track"><div class="fill" style="width:${Math.round((e.total / max) * 100)}%"></div></div>
    </div>`).join('')}</div>`;
}

function renderProducts(r) {
  const box = document.getElementById('products');
  if (r.status !== 'fulfilled' || !r.value.length) { box.innerHTML = `<div class="empty">Aún no hay productos vendidos.</div>`; return; }
  const max = Math.max(...r.value.map((p) => p.qty), 1);
  box.innerHTML = `<div class="rows">${r.value.map((p) => `
    <div class="row">
      <span class="name">${esc(p.name || 'Producto')}</span>
      <span class="amt">${num.format(p.qty)} u · ${money.format(p.revenue)}</span>
      <div class="track"><div class="fill" style="width:${Math.round((p.qty / max) * 100)}%"></div></div>
    </div>`).join('')}</div>`;
}

async function loadForecast() {
  const box = document.getElementById('forecast');
  const btn = document.getElementById('forecast-btn');
  btn.disabled = true; btn.textContent = 'Calculando…';
  box.innerHTML = `<div class="spinner">Consultando a la IA…</div>`;
  try {
    const f = await api.forecast(7);
    const items = (f.forecast || []).map((d) => `
      <div class="row"><span class="name">${esc(d.date)}</span><span class="amt">${money.format(d.expectedRevenue)}</span></div>`).join('');
    box.innerHTML =
      `<p class="muted" style="font-size:14px;margin:0 0 12px">${esc(f.summary || '')}</p>` +
      (items ? `<div class="rows">${items}</div>` : `<div class="empty">Sin datos suficientes para proyectar.</div>`);
  } catch (ex) {
    const msg = ex.status === 503 ? 'La IA no está configurada todavía (falta ANTHROPIC_API_KEY).' : (ex.message || 'No se pudo calcular el pronóstico.');
    box.innerHTML = `<div class="empty">${esc(msg)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Proyectar 7 días';
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
