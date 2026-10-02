/*
 * Finish Line service worker.
 *
 * Scope: installability + a graceful offline page. Nothing else.
 *
 * We deliberately do NOT cache HTML documents or API responses. Every screen
 * renders live scores, stuck flags and reward states; serving a cached shell
 * would show Isaac a score that is not true, which is the one thing this app
 * cannot do. Static build assets are already immutable and hashed, so the
 * browser HTTP cache handles them.
 */

const CACHE = 'finish-line-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return (
        cached ??
        new Response('Offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      );
    }),
  );
});
