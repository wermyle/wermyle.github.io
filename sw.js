/* wermyle — service worker: shows the notifications sent from the admin page (nothing is cached) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || 'wermyle', {
    body: d.body || 'Something new on the site',
    icon: 'icon-192.png',
    tag: d.tag,
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const tab = list.find(c => c.url.split('#')[0] === url.split('#')[0] && 'focus' in c);
    if (tab) return tab.navigate(url).then(c => (c || tab).focus());
    return self.clients.openWindow(url);
  }));
});
