// Service Worker — cache-first for static assets, network-only for API/auth

// Rest timer scheduling
let restTimerTimeoutId = null;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SCHEDULE_TIMER') {
    if (restTimerTimeoutId !== null) clearTimeout(restTimerTimeoutId);
    const delay = event.data.endTime - Date.now();
    if (delay <= 0) { showRestDoneNotification(); return; }
    restTimerTimeoutId = setTimeout(() => {
      showRestDoneNotification();
      restTimerTimeoutId = null;
    }, delay);
  }
  if (event.data?.type === 'CANCEL_TIMER') {
    if (restTimerTimeoutId !== null) { clearTimeout(restTimerTimeoutId); restTimerTimeoutId = null; }
  }
});

function showRestDoneNotification() {
  if (self.Notification?.permission !== 'granted') return;
  self.registration.showNotification('Rest done!', {
    body: 'Time to crush the next set.',
    icon: '/logo.png',
    badge: '/logo.png',
    vibrate: [200, 100, 200],
    tag: 'rest-timer',
    renotify: true,
    silent: false,
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

const CACHE_VERSION = 'v1';
const CACHE_NAME = `lift-app-${CACHE_VERSION}`;

// Pre-cache these on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/logo.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches from previous versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('lift-app-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for API calls and auth
  if (
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.hostname.includes('supabase')
  ) {
    return; // default network behavior
  }

  // Only cache same-origin GET requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Cache-first with background update for static assets
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request).then((response) => {
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        });

        // Return cached immediately, update in background
        return cached || networkFetch;
      })
    )
  );
});
