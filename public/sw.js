// Minimal service worker for iOS/Safari home-screen install
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Network-first pass-through; no offline cache to avoid stale data surprises
self.addEventListener('fetch', () => {
  // Intentionally empty — rely on default network behavior
});
