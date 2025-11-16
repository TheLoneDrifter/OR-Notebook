// Simple service worker: app-shell caching strategy
const CACHE_NAME = 'or-notebook-v1';
const ASSETS = [
  '/', // allow navigation fallback
  'or_notebook.html',
  'manifest.json',
  'favicon.svg',
  // CDN resources are attempted network-first; you can add local copies if desired
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // attempt to add app shell; ignore failures for missing files in dev
      return cache.addAll(ASSETS.map(s => new Request(s, {cache: 'reload'}))).catch(() => Promise.resolve());
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // navigation requests: try network first, fallback to cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        // clone into cache
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => { cache.put(req, clone); });
        return res;
      }).catch(() => caches.match('or_notebook.html'))
    );
    return;
  }

  // for same-origin assets: cache-first
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(resp => {
        // store in cache for offline
        return caches.open(CACHE_NAME).then(cache => { cache.put(req, resp.clone()); return resp; });
      }).catch(() => cached))
    );
    return;
  }

  // for cross-origin (CDN) requests: network-first with fallback to cache
  event.respondWith(
    fetch(req).then(resp => {
      // optionally cache cross-origin assets by request
      return resp;
    }).catch(() => caches.match(req))
  );
});