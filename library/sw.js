// Offline shell for Library.
//
// Network-first with a cache fallback: online launches get current code, and a
// launch with no connection falls straight back to the cache. PDF.js is bundled
// into the precache, so text extraction and search work with no signal.

const VERSION = 'v13';
const CACHE = `library-shell-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/oswald-latin.woff2',
  'js/app.js',
  'js/store.js',
  'js/schema.js',
  'js/db.js',
  'js/crypto.js',
  'js/icons.js',
  'js/ui.js',
  'js/pdftext.js',
  'js/viewer.js',
  'js/search.js',
  'js/suggest.js',
  'js/revision.js',
  '../vendor/polyfills.mjs',
  '../vendor/pdf.min.mjs',
  '../vendor/pdf.worker.min.mjs',
  '../vendor/pdf.worker.wrapper.mjs',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Cached one at a time rather than with addAll, which rejects the whole
      // batch if a single entry 404s and would leave the app with no offline
      // shell at all because of one mislaid file.
      .then((cache) => Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch((err) => console.warn('Could not precache', url, err))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'version') event.source?.postMessage({ version: VERSION });
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const copy = fresh.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return fresh;
  } catch {
    const hit = await caches.match(request);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      return (await caches.match('index.html')) || (await caches.match('./'));
    }
    throw new Error('offline and not cached');
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});
