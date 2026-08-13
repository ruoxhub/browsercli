self.__ordinaryWorkerMarker = 'ordinary-worker-before-dump';
importScripts('/nested-worker.js');
self.postMessage('ready');
self.onmessage = event => self.postMessage(event.data);
