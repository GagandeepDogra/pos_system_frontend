/* Service worker template; the build fills in the precache list and the cache version. */
const CACHE = 'dhaba-shell-__VERSION__';
const PRECACHE = __PRECACHE__;
// The shell's script and stylesheet load with `crossorigin`, so their requests carry an Origin header
// the precache requests did not; a `Vary: Origin` response would then miss the cache offline.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
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
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache the API: data must always be live.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (req.mode === 'navigate') {
    // Network first so updates arrive; the cached shell when offline.
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', MATCH)));
    return;
  }
  event.respondWith(caches.match(req, MATCH).then((hit) => hit || fetch(req)));
});
