// Service worker network-first: siempre intenta la red (así ves cada deploy al instante)
// y usa el cache solo como respaldo offline. La versión del cache se bumpea con la app.
const VERSION = '0.32.0';
const CACHE = `restaurapp-${VERSION}`;
const ASSETS = [
  './', './index.html',
  './css/themes.css', './css/app.css',
  './js/app.js', './js/api.js', './js/themes.js', './js/boot.js', './js/ui.js', './js/views.js',
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
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html'))),
  );
});
