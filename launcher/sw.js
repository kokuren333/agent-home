const CACHE = 'agent-home-shell-v6';
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/','/ui/styles.css','/launcher/styles.css','/launcher/app.js','/launcher/manifest.webmanifest']))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => { if (event.request.method === 'GET' && new URL(event.request.url).origin === self.location.origin) event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request))); });
