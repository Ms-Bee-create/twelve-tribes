// Minimal service worker — just enough to satisfy "installable" criteria
// (Chrome/Android require a manifest + a registered service worker with a
// fetch handler before it'll offer "Add to Home Screen" as a real app
// install rather than a plain bookmark).
//
// Deliberately network-first, not cache-first: this game ships new versions
// often and talks to a live Supabase backend, so serving a stale cached copy
// would be actively wrong (this bit a real testing session already this
// project — a browser served an old cached script after a file edit until
// a hard reload). The cache here is only a fallback for when there's no
// connection at all, not a performance optimization.
const CACHE_NAME = 'twelve-tribes-v1';
const APP_SHELL = [
  './syndicate-prototype-v26.html',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        // keep the offline fallback reasonably fresh
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
