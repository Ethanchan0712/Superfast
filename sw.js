/* =========================================================
   快送 · Service Worker
   版本更新時，請同時更新 CACHE_VERSION。
   ========================================================= */
const CACHE_VERSION = 'ks-v2.3.1-r3';
const CACHE_PREFIX = 'ks-';
const CORE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/utils.js',
  './js/speech.js',
  './js/pwa.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;

  // 導航：先網絡，失敗用快取 index，再退到 offline
  if(req.mode === 'navigate'){
    event.respondWith((async () => {
      try{
        return await fetch(req);
      }catch(e){
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('./index.html')) || (await cache.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  // 靜態資源：先快取，背景更新
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    if(cached) return cached;
    try{
      const res = await fetch(req);
      if(res.ok) cache.put(req, res.clone());
      return res;
    }catch(e){
      return cached || Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const noticeId = (event.notification.data && event.notification.data.tag) || null;
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for(const client of clientList){
      if(client.url.includes(self.registration.scope)){
        await client.focus();
        client.postMessage({ type:'ks-open-notice', id: noticeId });
        return;
      }
    }
    await self.clients.openWindow('./');
  })());
});
