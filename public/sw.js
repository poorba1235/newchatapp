self.addEventListener('push', (event) => {
    console.log('[Service Worker] Push Received.');

    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            console.warn('[Service Worker] Push data not JSON, using text:', event.data.text());
            data = { title: 'New Message', body: event.data.text() };
        }
    } else {
        console.warn('[Service Worker] Push event but no data found.');
        data = { title: 'New Message', body: 'You have a new message!' };
    }

    console.log('[Service Worker] Notification data to show:', data);

    const options = {
        body: data.body || 'New message arrived!',
        icon: data.icon || '/logo192.png',
        badge: '/favicon.ico',
        data: data.data || {},
        vibrate: [200, 100, 200],
        tag: 'family-chat-push',
        renotify: true,
        requireInteraction: true // Keeps notification visible until clicked
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Family Chat', options)
            .then(() => console.log('[Service Worker] showNotification successful'))
            .catch(err => {
                console.error('[Service Worker] showNotification error:', err);
                return self.registration.showNotification('Family Chat', {
                    body: data.body || 'New message arrived!',
                    icon: '/logo192.png'
                });
            })
    );
});

self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification click Received.');
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === '/' || client.url.includes(self.location.origin)) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
