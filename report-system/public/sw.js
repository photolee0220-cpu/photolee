// 업무보고 시스템 알림 (푸시)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '업무보고', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-64.png',
    tag: d.tag,
    // 같은 방에 메시지가 이어서 와도 매번 소리·진동이 나도록 (안 하면 두 번째부터 조용히 바뀐다)
    renotify: !!d.tag,
    vibrate: [180, 80, 180],
    data: { url: d.url || self.registration.scope },
  }));
});

// 알림을 누르면 그 방·공지로 바로 간다. 앱이 열려 있으면 그 창을 앞으로 가져와 이동시킨다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        c.postMessage({ type: 'open', url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
