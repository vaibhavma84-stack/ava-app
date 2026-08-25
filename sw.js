// Offline shell.
//
// Network-first, cache-fallback. Cache-first was wrong for this app: an
// installed iOS web app would keep serving the cached build forever, so pushed
// fixes never arrived no matter how many times it was relaunched.
//
// Now a launch with a connection always gets current code, and a launch without
// one falls straight back to the cache, so the app stays fully usable at sea.

const VERSION = 'v12';
const CACHE = `ava-shell-${VERSION}`;

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
  'js/db.js',
  'js/crypto.js',
  'js/icons.js',
  'js/ui.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache:'reload' bypasses the HTTP cache, so precaching cannot store a
      // stale copy of a file that was just deployed.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
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
    // A cold navigation offline still needs the shell.
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
