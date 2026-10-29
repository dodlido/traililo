// Offline support. The app itself is cached on first visit; map tiles you have looked at are kept too.
const APP = 'traililo-app-v2';
const TILES = 'traililo-tiles-v1';
const SHELL = ['./', './index.html', './app.js', './app.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const MAX_TILES = 900;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('arcgisonline.com')) {
    // tiles: use what we have, fetch in the background to keep it fresh
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((r) => {
            if (r.ok) {
              c.put(req, r.clone());
              trim(c);
            }
            return r;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  // the app: network first so updates arrive, cache when offline
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok) caches.open(APP).then((c) => c.put(req, r.clone()));
        return r;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('./index.html'))),
  );
});
