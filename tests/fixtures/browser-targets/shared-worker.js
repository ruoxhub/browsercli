self.__sharedWorkerMarker = 'shared-worker-before-dump';
self.onconnect = event => {
  event.ports[0].start();
  event.ports[0].postMessage('ready');
};
