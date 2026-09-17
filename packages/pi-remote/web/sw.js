/**
 * pi-remote service worker - Phase 0 skeleton.
 *
 * Caches the app shell for offline opens and shows content-free wake-up
 * notifications. Push subscription + relay sync land in Phase 3.
 */

'use strict';

const CACHE = 'pi-remote-v0-4-0';
const SHELL = ['./index.html', './manifest.webmanifest', './app.js', './relay.js', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});

// Content-free wake-up: never renders message bodies from push payloads.
self.addEventListener('push', (event) => {
  let room = 'main';
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.rm === 'string') room = data.rm;
  } catch {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification('pi-remote', {
      body: `Agent update in room ${room} — open to read.`,
      tag: `pi-remote-${room}`,
      icon: './icon.svg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'pi-remote-sync' });
          return client.focus();
        }
      }
      return self.clients.openWindow('./index.html');
    }),
  );
});

// The push service rotated our subscription (rare): re-subscribe with the
// stored VAPID key if we have one, else flag the app to re-send on next open.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const reg = await self.registration;
        const old = await reg.pushManager.getSubscription();
        const vapidKey = old?.options?.applicationServerKey;
        if (!vapidKey) return;
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey });
        // The app re-sends the new subscription on next boot (it owns the relay).
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'pi-remote-push-dirty' });
      } catch {
        /* app boot path covers the rest */
      }
    })(),
  );
});
