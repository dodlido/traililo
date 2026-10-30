// Offline support. The app itself is cached on first visit; map tiles you have looked at are kept too.
const APP = 'traililo-app-v3';
const TILES = 'traililo-tiles-v1';
// tiles you chose to save ahead of the trip: kept until you clear them, never trimmed
const OFFLINE = 'traililo-offline-v1';
const PHOTOS = 'traililo-photos-v1';
const SHELL = ['./', './index.html', './app.js', './app.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const MAX_TILES = 900;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== TILES && k !== OFFLINE && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function trim(cache, max = MAX_TILES) {
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
  if (url.hostname.endsWith('arcgisonline.com')) {
    // tiles: use what we have (saved packs first), fetch in the background to keep it fresh
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = (await caches.match(req)) || (await c.match(req));
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

// The page asks us to save a list of map tiles and pictures. Doing it here lets it carry on if the page is backgrounded.
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'save') return;
  e.waitUntil(save(d.tiles || [], d.images || [], e.source));
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'forget') e.waitUntil(caches.delete(OFFLINE).then(() => e.source && e.source.postMessage({ type: 'forgotten' })));
});

async function save(tiles, images, client) {
  const tileCache = await caches.open(OFFLINE);
  const photoCache = await caches.open(PHOTOS);
  const jobs = [...tiles.map((u) => [u, tileCache]), ...images.map((u) => [u, photoCache])];
  const total = jobs.length;
  let done = 0;
  let bad = 0;
  const tell = (type) => client && client.postMessage({ type, done, bad, total });
  async function worker() {
    while (jobs.length) {
      const [u, cache] = jobs.pop();
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors' }).catch(() => fetch(u, { mode: 'no-cors' }));
          if (r && (r.ok || r.type === 'opaque')) await cache.put(u, r);
          else bad++;
        }
      } catch {
        bad++;
      }
      done++;
      if (done % 20 === 0) tell('progress');
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  tell('done');
}
