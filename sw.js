const CACHE_NAME = 'property-navigator-v3'; // Incremented cache version
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/images/icon-128.png',
  '/images/icon-512.png',
  'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/exif-js'
];

// Install: Cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('SW: Caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('SW: Clearing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// NEW: Listen for messages from the app
self.addEventListener('message', event => {
    if (event.data.action === 'cache-tiles') {
        console.log('SW: Received tile URLs to cache.');
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
                console.log('SW: Caching', event.data.urls.length, 'tiles.');
                // Use addAll to fetch and cache all tile URLs.
                // It will stop if any single request fails.
                return cache.addAll(event.data.urls).catch(err => {
                    console.error('SW: Failed to cache some tiles.', err);
                });
            })
        );
    }
});


// Fetch: Serve from cache first, then network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      // If we have a match in the cache, return it.
      if (response) {
        return response;
      }
      // Otherwise, fetch from the network.
      return fetch(event.request);
    })
  );
});
