// SILENT KILLER service worker.
// Code (html/js/css) is ALWAYS revalidated with the server so phones never run an old
// version. Sounds/images are cached (fast + offline-safe); bump CACHE when they change.
const CACHE = 'sk-assets-v5';
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isAsset = /\/(assets|vendor)\//.test(url.pathname);
  if (isAsset) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
  } else {
    // no-cache = always ask the server (cheap 304 via ETag), never trust the 10-minute HTTP cache
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).catch(() => caches.match(e.request)));
  }
});
