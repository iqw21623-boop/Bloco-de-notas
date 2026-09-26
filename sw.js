var CACHE_NAME = 'bloco-de-notas-v2';
var SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg', './icon-maskable.svg'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Rede primeiro (sempre pega a versão mais nova); sem internet, usa o cache.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(function (resp) {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        var copy = resp.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      }
      return resp;
    }).catch(function () {
      return caches.match(event.request).then(function (c) { return c || caches.match('./index.html'); });
    })
  );
});
