// Service worker: cachea el shell de la app (offline básico). La API nunca se cachea.
const CACHE = 'restaurapp-v1';
const ASSETS = [
  './', './index.html',
  './css/themes.css', './css/app.css',
  './js/app.js', './js/api.js', './js/themes.js', './js/boot.js',
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
  if (e.request.method !== 'GET') return;                 // no tocar POST/PATCH
  if (url.origin !== location.origin) return;             // no tocar fuentes externas
  if (url.pathname.startsWith('/api')) return;            // datos siempre frescos
  if (!url.pathname.startsWith('/app')) return;           // solo el scope de la app

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match('./index.html'))),
  );
});
