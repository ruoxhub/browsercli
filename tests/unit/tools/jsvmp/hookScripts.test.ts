/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import vm from 'node:vm';

import {
  buildJsvmpProxyHook,
  buildJsvmpTransparentHook,
} from '../../../../src/tools/jsvmp/hookScripts.js';

interface JsvmpLogEntry {
  type: string;
  key?: string;
  name?: string;
  value?: string;
}

function createBrowserRealm(options: {rejectProxy?: boolean} = {}): vm.Context {
  const realm = vm.createContext({
    console: {log: () => undefined, warn: () => undefined},
  });

  vm.runInContext(
    `
class Navigator {
  #userAgent = 'BrowserCLI/1.0';
  get userAgent() { return this.#userAgent; }
  get platform() { return 'TestOS'; }
}
class Screen {
  get width() { return 1920; }
}
class History {
  #scrollRestoration = 'auto';
  get length() { return 1; }
  get scrollRestoration() { return this.#scrollRestoration; }
  set scrollRestoration(value) { this.#scrollRestoration = value; }
}
class Performance {
  get timeOrigin() { return 1; }
  now() { return 2; }
}
class Location {
  get href() { return 'https://example.com/'; }
}
class Document {
  get visibilityState() { return 'visible'; }
}
class HTMLDocument extends Document {}

globalThis.window = globalThis;
globalThis.navigator = new Navigator();
globalThis.screen = new Screen();
globalThis.history = new History();
globalThis.performance = new Performance();
globalThis.location = new Location();
globalThis.document = new HTMLDocument();
globalThis.localStorage = {kind: 'local'};
globalThis.sessionStorage = {kind: 'session'};
globalThis.__originalNavigator = globalThis.navigator;
globalThis.__originalCall = Function.prototype.call;
globalThis.__originalReflectGet = Reflect.get;
`,
    realm,
  );

  if (options.rejectProxy) {
    vm.runInContext(
      `globalThis.Proxy = function ForbiddenProxy() {
        throw new Error('Proxy construction is forbidden');
      };`,
      realm,
    );
  }

  return realm;
}

function readLog(realm: vm.Context): JsvmpLogEntry[] {
  const serialized = vm.runInContext(
    'JSON.stringify(window.__mcp_jsvmp_log)',
    realm,
  ) as string;
  return JSON.parse(serialized) as JsvmpLogEntry[];
}

describe('JSVMP proxy hook script', () => {
  it('records brand-checked property reads without changing their semantics', () => {
    const realm = createBrowserRealm();
    vm.runInContext(
      buildJsvmpProxyHook({
        scriptUrl: '',
        maxEntries: 1,
        trackCalls: false,
        trackProps: true,
        trackReflect: false,
        proxyObjects: ['navigator'],
      }),
      realm,
    );

    vm.runInContext('navigator.userAgent; navigator.platform;', realm);

    assert.deepEqual(
      readLog(realm).map(entry => entry.type),
      ['proxy_get'],
    );
    assert.equal(readLog(realm)[0].key, 'userAgent');
    assert.equal(readLog(realm)[0].value, 'BrowserCLI/1.0');
  });

  it('records Function.prototype.call invocations', () => {
    const realm = createBrowserRealm();
    vm.runInContext(
      buildJsvmpProxyHook({
        scriptUrl: '',
        maxEntries: 10,
        trackCalls: true,
        trackProps: false,
        trackReflect: false,
        proxyObjects: [],
      }),
      realm,
    );

    const value = vm.runInContext(
      '(function add(a, b) { return a + b; }).call(null, 2, 3)',
      realm,
    );

    assert.equal(value, 5);
    assert.ok(
      readLog(realm).some(
        entry => entry.type === 'fn_call' && entry.name === 'add',
      ),
    );
  });

  it('does not consume the log budget with its own installation work', () => {
    const realm = createBrowserRealm();
    vm.runInContext(
      buildJsvmpProxyHook({
        scriptUrl: '',
        maxEntries: 1,
        trackCalls: true,
        trackProps: true,
        trackReflect: true,
        proxyObjects: ['navigator', 'performance'],
      }),
      realm,
    );

    assert.deepEqual(readLog(realm), []);
    vm.runInContext('navigator.userAgent', realm);
    assert.deepEqual(
      readLog(realm).map(entry => entry.type),
      ['proxy_get'],
    );
  });

  it('records brand-checked property writes without changing their semantics', () => {
    const realm = createBrowserRealm();
    vm.runInContext(
      buildJsvmpProxyHook({
        scriptUrl: '',
        maxEntries: 10,
        trackCalls: false,
        trackProps: true,
        trackReflect: false,
        proxyObjects: ['history'],
      }),
      realm,
    );

    const value = vm.runInContext(
      "history.scrollRestoration = 'manual'; history.scrollRestoration",
      realm,
    );

    assert.equal(value, 'manual');
    assert.ok(
      readLog(realm).some(
        entry =>
          entry.type === 'proxy_set' && entry.key === 'scrollRestoration',
      ),
    );
  });

  it('restores every patched intrinsic and proxied global on uninstall', () => {
    const realm = createBrowserRealm();
    vm.runInContext(
      buildJsvmpProxyHook({
        scriptUrl: '',
        maxEntries: 10,
        trackCalls: true,
        trackProps: true,
        trackReflect: true,
        proxyObjects: ['navigator'],
      }),
      realm,
    );

    assert.equal(
      vm.runInContext(
        `
window.__mcp_jsvmp_uninstall();
navigator === window.__originalNavigator &&
  Function.prototype.call === window.__originalCall &&
  Reflect.get === window.__originalReflectGet &&
  window.__mcp_jsvmp_installed === false;
`,
        realm,
      ),
      true,
    );
  });
});

describe('JSVMP transparent hook script', () => {
  it('records prototype getter reads without constructing a Proxy', () => {
    const realm = createBrowserRealm({rejectProxy: true});
    vm.runInContext(
      buildJsvmpTransparentHook({scriptUrl: '', maxEntries: 10}),
      realm,
    );

    assert.equal(
      vm.runInContext('navigator.userAgent', realm),
      'BrowserCLI/1.0',
    );
    assert.ok(
      readLog(realm).some(
        entry => entry.type === 'transparent_get' && entry.key === 'userAgent',
      ),
    );
  });
});
