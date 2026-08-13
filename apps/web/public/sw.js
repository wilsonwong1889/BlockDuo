/**
 * Offline support for classic mode.
 *
 * Stale-while-revalidate over same-origin GETs: the game opens instantly from
 * cache and quietly updates in the background. Duo needs the network by
 * definition, so socket and API traffic is never touched.
 */
const CACHE = 'blokduo-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html'])));
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
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The room API and its WebSocket are live by nature; caching them would serve
  // a stale game.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached ?? caches.match('/index.html'));

      return cached ?? network;
    }),
  );
});
