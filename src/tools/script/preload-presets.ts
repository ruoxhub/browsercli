/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export type PreloadPreset =
  | 'capture-all-fetch'
  | 'capture-all-xhr'
  | 'capture-all-requests'
  | 'log-cookies';

export const PRELOAD_PRESETS: Record<PreloadPreset, string> = {
  'capture-all-fetch': `(function() {
  'use strict';
  if (window.__preloadFetchHooked) return;
  window.__preloadFetchHooked = true;
  window.__capturedFetch = [];
  const origFetch = window.fetch;
  window.fetch = function() {
    const args = Array.from(arguments);
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    const record = { url, method, body: init.body, timestamp: Date.now() };
    window.__capturedFetch.push(record);
    console.log('[preload:capture-all-fetch]', method, url);
    return origFetch.apply(this, arguments);
  };
  window.fetch.__proto__ = origFetch.__proto__;
})();`,

  'capture-all-xhr': `(function() {
  'use strict';
  if (window.__preloadXhrHooked) return;
  window.__preloadXhrHooked = true;
  window.__capturedXhr = [];
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    const record = { method: '', url: '', timestamp: Date.now() };
    window.__capturedXhr.push(record);
    const origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url) {
      record.method = String(method).toUpperCase();
      record.url = String(url);
      console.log('[preload:capture-all-xhr]', record.method, record.url);
      return origOpen.apply(xhr, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;
})();`,

  'capture-all-requests': `(function() {
  'use strict';
  if (window.__preloadAllHooked) return;
  window.__preloadAllHooked = true;
  window.__capturedRequests = [];

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = function() {
    const args = Array.from(arguments);
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    window.__capturedRequests.push({ type: 'fetch', url, method, timestamp: Date.now() });
    console.log('[preload:capture-all-requests] fetch', method, url);
    return origFetch.apply(this, arguments);
  };
  window.fetch.__proto__ = origFetch.__proto__;

  // Hook XHR
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    const record = { type: 'xhr', method: '', url: '', timestamp: Date.now() };
    window.__capturedRequests.push(record);
    const origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url) {
      record.method = String(method).toUpperCase();
      record.url = String(url);
      console.log('[preload:capture-all-requests] xhr', record.method, record.url);
      return origOpen.apply(xhr, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;
})();`,

  'log-cookies': `(function() {
  'use strict';
  if (window.__preloadCookieHooked) return;
  window.__preloadCookieHooked = true;
  window.__cookieLog = [];
  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                     Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
  if (!cookieDesc) return;
  Object.defineProperty(document, 'cookie', {
    get: function() {
      const val = cookieDesc.get.call(this);
      return val;
    },
    set: function(val) {
      window.__cookieLog.push({ op: 'set', value: String(val), timestamp: Date.now() });
      console.log('[preload:log-cookies] set:', String(val).slice(0, 80));
      return cookieDesc.set.call(this, val);
    },
    configurable: true,
  });
})();`,
};

export function getPreloadPreset(preset: PreloadPreset): string {
  return PRELOAD_PRESETS[preset];
}
