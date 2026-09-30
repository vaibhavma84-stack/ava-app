// Offline shell.
//
// Network-first, cache-fallback. Cache-first was wrong for this app: an
// installed iOS web app would keep serving the cached build forever, so pushed
// fixes never arrived no matter how many times it was relaunched.
//
// Now a launch with a connection always gets current code, and a launch without
// one falls straight back to the cache, so the app stays fully usable at sea.

const VERSION = 'v20';
const CACHE = `ava-shell-${VERSION}`;

// The certificate reader is megabytes and only wanted once a scan is asked
// for, so it lives in a cache of its own, apart from the shell's.
const OCR_CACHE = 'ava-ocr-v1';
const isOcr = (url) => /\/vendor\/ocr\//.test(url);

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/oswald-latin.woff2',
  'js/app.js',
  'js/store.js',
  'js/schema.js',
  'js/derive.js',
  'js/calendar.js',
  'js/pdf.js',
  'js/cv.js',
  'js/docx.js',
  'js/zip.js',
  'js/join.js',
  'js/scan.js',
  'js/ocr.js',
  'js/faceid.js',
  'js/db.js',
  'js/crypto.js',
  'js/icons.js',
  'js/ui.js',
  'js/viewer.js',
  'vendor/polyfills.mjs',
  'vendor/pdf.min.mjs',
  'vendor/pdf.worker.min.mjs',
  'vendor/pdf.worker.wrapper.mjs',
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
      // Only AVA's own old caches: the Library shares this origin, and
      // clearing its cache would leave it without an offline copy.
      .then((keys) => Promise.all(keys
        .filter((k) => (k.startsWith('ava-shell-') && k !== CACHE) || (k.startsWith('ava-ocr-') && k !== OCR_CACHE))
        .map((k) => caches.delete(k))))
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
    // A cold navigation offline still needs the shell.
    if (request.mode === 'navigate') {
      return (await caches.match('index.html')) || (await caches.match('./'));
    }
    throw new Error('offline and not cached');
  }
}

/** The reader's files never change under the same name, so the cache answers first. */
async function ocrFirst(request) {
  const hit = await caches.match(request, { cacheName: OCR_CACHE });
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const copy = fresh.clone();
    caches.open(OCR_CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(isOcr(req.url) ? ocrFirst(req) : networkFirst(req));
});
