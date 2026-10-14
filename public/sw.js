const CACHE = 'sidequest-shell-v1';
const SHELL = ['/Sidequest/', '/Sidequest/manifest.webmanifest', '/Sidequest/icons/icon.svg'];
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || 'A task is ready when you are.' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Sidequest reminder', {
    body: payload.body || 'A task is ready when you are.',
    icon: '/Sidequest/icons/icon.svg',
    badge: '/Sidequest/icons/icon.svg',
    tag: payload.tag || 'sidequest-reminder',
    data: { url: payload.url || '/Sidequest/?view=tasks' },
  }));
});
self.addEventListener('notificationclick', event => {
  const requested = event.notification.data && event.notification.data.url;
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    const destination = new URL(requested || '/Sidequest/', self.location.origin);
    const safeUrl = destination.origin === self.location.origin ? destination.href : new URL('/Sidequest/', self.location.origin).href;
    const existing = clientList.find(client => 'focus' in client);
    if (existing) {
      if ('navigate' in existing) void existing.navigate(safeUrl);
      return existing.focus();
    }
    return self.clients.openWindow(safeUrl);
  }));
});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put('/Sidequest/', response.clone()));
      return response;
    }).catch(() => caches.match('/Sidequest/')));
    return;
  }
  if (url.pathname.startsWith('/Sidequest/_astro/') || url.pathname.startsWith('/Sidequest/icons/')) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});
