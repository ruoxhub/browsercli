self.__serviceWorkerMarker = 'service-worker-before-dump';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event =>
  event.waitUntil(self.clients.claim()),
);
