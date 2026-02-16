// yourSQLfriend Service Worker
// Caches static assets for fast app shell loading;
// all API/data requests pass through to the Flask server.

const CACHE_NAME = 'ysqf-v%%VERSION%%';
const STATIC_ASSETS = [
  '/static/style.css',
  '/static/js/app.js',
  '/static/js/state.js',
  '/static/js/ui.js',
  '/static/js/chat.js',
  '/static/js/sql.js',
  '/static/js/charts.js',
  '/static/js/upload.js',
  '/static/js/providers.js',
  '/static/js/search.js',
  '/static/js/notes.js',
  '/static/js/erdiagram.js',
  '/static/lib/marked.min.js',
  '/static/lib/purify.min.js',
  '/static/lib/highlight.min.js',
  '/static/lib/gridjs.umd.js',
  '/static/lib/chart.umd.min.js',
  '/static/lib/styles/atom-one-dark.min.css',
  '/static/fonts/jetbrains-mono-v400.woff2',
  '/static/fonts/jetbrains-mono-v500.woff2',
  '/static/fonts/jetbrains-mono-v600.woff2',
  '/static/fonts/jetbrains-mono-v700.woff2',
  '/static/fonts/ibm-plex-sans-v400.woff2',
  '/static/fonts/ibm-plex-sans-v500.woff2',
  '/static/fonts/ibm-plex-sans-v600.woff2',
  '/static/favicon.ico',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  } else {
    event.respondWith(fetch(event.request));
  }
});
