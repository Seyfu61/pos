// Service Worker: macht die Kasse offline nutzbar.
// Strategie "Netz zuerst": Ist das Netz da, kommt immer die aktuelle Version;
// ohne Netz wird die zuletzt geladene Fassung aus dem Zwischenspeicher verwendet.

const CACHE = 'kasse-v12'; // muss zu APP_VERSION in js/version.js passen
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/preact-htm.js',
  'vendor/uqr.js',
  'js/main.js',
  'js/version.js',
  'js/lib/ui.js',
  'js/lib/update.js',
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
  'js/views/open.js',
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
      // cache: 'reload' – frisch vom Server holen, nicht aus dem Zwischenspeicher des Browsers
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
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
  // Immer beim Server nachfragen (no-cache): GitHub Pages erlaubt dem Browser sonst, Dateien 10 Minuten
  // zwischenzuspeichern – dann könnte das iPad alte und neue Dateien mischen. Unveränderte Dateien kosten nur eine kurze Rückfrage.
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  event.respondWith(
    fetch(fresh)
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
