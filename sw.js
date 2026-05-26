const CACHE_NAME = 'fridge-dinner-tracker-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ai.js',
  './db.js',
  './icon-512.png',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+JP:wght@300;400;700&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Google Apps Script (GAS) APIリクエストはキャッシュせず常にネットワークへ
  if (e.request.url.includes('script.google.com') || e.request.url.includes('script.googleusercontent.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 外部フォントやGoogle Fontsなどは「キャッシュ優先」
  if (e.request.url.startsWith('http') && !e.request.url.includes(location.hostname)) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request);
      })
    );
    return;
  }

  // アプリのローカル資産（HTML/CSS/JS等）は「ネットワーク優先 (Network-First)」で即時更新
  e.respondWith(
    fetch(e.request).then((networkResponse) => {
      // 通信成功時は最新レスポンスをキャッシュに保存して返す
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
      }
      return networkResponse;
    }).catch(() => {
      // オフラインまたは通信障害時は、キャッシュから即座に返す（完全オフライン対応）
      return caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || caches.match('./index.html');
      });
    })
  );
});
