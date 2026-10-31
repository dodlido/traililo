// The app itself is cached on first visit so it still opens with a weak signal. Map tiles are not stored.
const APP = 'traililo-app-v4';
const PHOTOS = 'traililo-photos-v1';
const SHELL = ['./', './index.html', './app.js', './app.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function trim(cache, max = 300) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)(wikimedia\.org)$/.test(url.hostname) || url.pathname.startsWith('/storage/v1/object/public/photos/')) {
    // photos: show what we have, refresh quietly
    if (req.destination !== 'image') return;
    e.respondWith(
      caches.open(PHOTOS).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((r) => {
            if (r.ok || r.type === 'opaque') {
              c.put(req, r.clone());
              trim(c, 300);
            }
            return r;
          })
          .catch(() => hit || Response.error());
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
