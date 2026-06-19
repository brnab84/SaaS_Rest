// Service worker network-first: siempre intenta la red (así ves cada deploy al instante)
// y usa el cache solo como respaldo offline. La versión del cache se bumpea con la app.
const VERSION = '0.43.0';
const CACHE = `restaurapp-${VERSION}`;
const ASSETS = [
  './', './index.html',
  './css/themes.css', './css/app.css',
  './js/app.js', './js/api.js', './js/themes.js', './js/boot.js', './js/ui.js', './js/views.js',
  './vendor/jsuites.min.js', './vendor/jsuites.min.css',
  './vendor/jspreadsheet.min.js', './vendor/jspreadsheet.min.css',
  './manifest.webmanifest', './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api')) return;       // datos siempre frescos
  if (!url.pathname.startsWith('/app')) return;      // solo el scope de la app

  e.respondWith(
    // `cache: 'reload'` evita que el navegador devuelva una copia vieja del HTTP cache:
    // siempre baja la última versión del servidor cuando hay red.
    fetch(e.request, { cache: 'reload' })
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html'))),
  );
});
