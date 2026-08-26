const CACHE_NAME = 'tvd-static-v10-app-1.8.9';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=189',
  './src/styles.css',
  './src/player.css',
  './src/audio-preference.js?v=187',
  './src/app.js?v=187',
  './assets/logo_tvd-internet.png',
  './assets/apple-touch-icon-tvd-180.png',
  './assets/icon-tvd-192.png',
  './assets/icon-tvd-512.png',
  './assets/icon-tvd-maskable-192.png',
  './assets/icon-tvd-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const esHls = /\.m3u8($|\?)/i.test(url.pathname + url.search) || /\.ts($|\?)/i.test(url.pathname + url.search);

  if (esHls || url.hostname === 'motortv.scad.mx') {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
    )
  );
});