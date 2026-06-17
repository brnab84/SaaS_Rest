// Los 6 temas. `swatches` son solo para el selector visual (bg, surface, accent, accent-2).
export const THEMES = [
  { id: 'comanda', name: 'Comanda', swatches: ['#f3ecd9', '#fffdf6', '#c0392b', '#1d7a5f'] },
  { id: 'brutalist', name: 'Brutalist', swatches: ['#faf4e4', '#ffffff', '#e2483d', '#f2b600'] },
  { id: 'brasa', name: 'Brasa', swatches: ['#15110d', '#211b15', '#ff7a1a', '#f5b301'] },
  { id: 'mercado', name: 'Mercado', swatches: ['#fbf9f3', '#ffffff', '#2f7d4f', '#c5613b'] },
  { id: 'neon', name: 'Neón', swatches: ['#0e1116', '#161b22', '#22d3ee', '#8b5cf6'] },
  { id: 'tinta', name: 'Tinta', swatches: ['#ffffff', '#f4f4f2', '#d7263d', '#111111'] },
];

const KEY = 'restaurapp.theme';
const DEFAULT = 'comanda';

export function getTheme() {
  try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; }
}

export function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem(KEY, id); } catch {}
}

// Renderiza el selector: nombre del tema arriba + los 6 swatches en una sola fila.
export function renderThemePicker(container) {
  const current = getTheme();
  const currentName = THEMES.find((t) => t.id === current)?.name || '';
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'theme-picker';

  const label = document.createElement('div');
  label.className = 'theme-name';
  label.innerHTML = `Tema · <strong>${currentName}</strong>`;
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.className = 'theme-swatches';
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = t.name;
    b.setAttribute('aria-label', `Tema ${t.name}`);
    b.setAttribute('aria-pressed', String(t.id === current));
    for (const c of t.swatches) {
      const s = document.createElement('span');
      s.style.background = c;
      b.appendChild(s);
    }
    b.addEventListener('click', () => {
      applyTheme(t.id);
      renderThemePicker(container); // refresca estado seleccionado + nombre
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
  container.appendChild(wrap);
}
