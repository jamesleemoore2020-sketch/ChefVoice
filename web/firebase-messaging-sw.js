/* global importScripts, firebase */
// Background push handler for ChefVoice web push.
//
// FCM looks for this exact filename at the site root. It runs in its own worker
// context, separate from sw.js (the offline shell), and uses the compat SDK
// because a service worker cannot use the modular ESM build.
//
// The backend sends data-only messages (see chefvoice-notifications), so the
// notification is constructed here rather than by the browser.

importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDPjXKnbVOMyV4pyeNjhqqjEoH3ebXyBgw',
  authDomain: 'chefvoice-d7fec.firebaseapp.com',
  projectId: 'chefvoice-d7fec',
  storageBucket: 'chefvoice-d7fec.firebasestorage.app',
  messagingSenderId: '569377936753',
  appId: '1:569377936753:web:9b4a80907391f62b5d92d0'
});

firebase.messaging().onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  const title = data.title || 'ChefVoice';
  // Message previews are deliberately omitted by the backend; it sends
  // "Open ChefVoice to read it." rather than private message content.
  self.registration.showNotification(title, {
    body: data.body || 'You have new ChefVoice activity.',
    icon: '/assets/chefvoice-icon.png',
    badge: '/assets/chefvoice-icon.png',
    tag: data.eventId || undefined,
    data
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  // Route to the surface the notification is about; the app reads this on load.
  const target = data.conversationId ? '/?tab=inbox' : data.recipeId ? '/?tab=community' : '/?tab=inbox';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
