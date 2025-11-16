// Simple service worker: app-shell caching strategy (updated to cache unified stylesheet and handle theme-change and note-* messages)
const CACHE_NAME = 'or-notebook-v2';
const ASSETS = [
  '/', // navigation fallback
  'index.html',
  'settings/index.html',
  'app.js',
  'styles.css',
  'manifest.json',
  'favicon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
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

// Service worker will forward incoming messages (theme-change and note-*) to all clients
self.addEventListener('message', event => {
  const data = event.data || {};
  if(!data || !data.type) return;
  // forward to clients any important events
  if(data.type === 'theme-change' || (typeof data.type === 'string' && data.type.startsWith('note-'))){
    const payload = data;
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(c => {
        try { c.postMessage(payload); } catch(e){}
      });
    });
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => { cache.put(req, clone); });
        return res;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  const url = new URL(req.url);
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(resp => {
        return caches.open(CACHE_NAME).then(cache => { cache.put(req, resp.clone()); return resp; });
      }).catch(() => cached))
    );
    return;
  }

  // cross-origin network-first
  event.respondWith(
    fetch(req).then(resp => resp).catch(() => caches.match(req))
  );
});