// Service Worker: macht die Kasse offline nutzbar.
// Strategie "Netz zuerst": Ist das Netz da, kommt immer die aktuelle Version;
// ohne Netz wird die zuletzt geladene Fassung aus dem Zwischenspeicher verwendet.

const CACHE = 'kasse-v7';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/preact-htm.js',
  'vendor/uqr.js',
  'js/main.js',
  'js/lib/ui.js',
  'js/lib/util.js',
  'js/lib/db.js',
  'js/lib/store.js',
  'js/lib/order.js',
  'js/lib/csv.js',
  'js/data/menu.js',
  'js/data/defaults.js',
  'js/print/index.js',
  'js/print/raster.js',
  'js/print/receipt.js',
  'js/print/webprnt.js',
  'js/views/pos.js',
  'js/views/orders.js',
  'js/views/customers.js',
  'js/views/settings.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Nur eigene Dateien behandeln – Druckaufträge an den Drucker gehen unverändert durch.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? caches.match('index.html'))),
  );
});
