/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it, mock} from 'node:test';

import {BrowserManager} from '../../../src/modules/browser/index.js';
import {
  connectBrowser,
  disconnectBrowser,
  getBrowserConnectionMode,
  getBrowserConnectionStatus,
  isSameBrowserTarget,
} from '../../../src/worker/BrowserConnectionManager.js';
import {workerActivityCoordinator} from '../../../src/worker/WorkerActivityCoordinator.js';

describe('BrowserConnectionManager', () => {
  it('classifies configured connection targets', () => {
    assert.strictEqual(
      getBrowserConnectionMode({browserURL: 'http://127.0.0.1:9222'}),
      'attach',
    );
    assert.strictEqual(
      getBrowserConnectionMode({wsEndpoint: 'ws://127.0.0.1/devtools'}),
      'ws-endpoint',
    );
    assert.strictEqual(
      getBrowserConnectionMode({remoteDebuggingUrl: 'wss://host/devtools'}),
      'ws-endpoint',
    );
    assert.strictEqual(getBrowserConnectionMode({channel: 'stable'}), 'launch');
  });

  it('reports live pages without exposing configuration', () => {
    const status = getBrowserConnectionStatus(
      {
        isBrowserConnected: () => true,
        getContext: () => ({pages: () => [{}, {}]}),
      } as never,
      {browserURL: 'http://127.0.0.1:9222'},
    );

    assert.deepEqual(status, {connected: true, mode: 'attach', pages: 2});
  });

  it('normalizes stale or missing browser state to disconnected', () => {
    const status = getBrowserConnectionStatus(
      {
        isBrowserConnected: () => false,
        getContext: () => null,
      } as never,
      {wsEndpoint: 'ws://127.0.0.1/devtools'},
    );

    assert.deepEqual(status, {
      connected: false,
      mode: 'disconnected',
      pages: 0,
    });
  });

  it('connectBrowser resets old instance, creates new, binds to contextProvider', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(),
    );
    const fakeBrowser = {
      contexts: () => [{pages: () => []}],
      isConnected: () => true,
      version: () => 'test',
    };
    const fakeManager = {
      ensureBrowser: () => Promise.resolve(fakeBrowser),
      getContext: () => fakeBrowser.contexts()[0],
      getBrowser: () => fakeBrowser,
      isConnected: () => true,
    };
    const getInstanceMock = mock.method(
      BrowserManager,
      'getInstance',
      () => fakeManager,
    );

    const setBrowserManager = mock.fn();
    const setBrowser = mock.fn();
    const setContext = mock.fn();
    const clearContext = mock.fn();
    const init = mock.fn(() => Promise.resolve());
    const contextProvider = {
      setBrowserManager,
      setBrowser,
      setContext,
      clearContext,
      init,
    };

    const config = {headless: true, isolated: true};
    const result = await connectBrowser(
      contextProvider as never,
      config as never,
    );

    assert.strictEqual(resetMock.mock.callCount(), 1);
    assert.strictEqual(getInstanceMock.mock.callCount(), 1);
    assert.strictEqual(setBrowserManager.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.callCount(), 2);
    assert.strictEqual(setBrowser.mock.calls[0].arguments[0], null);
    assert.strictEqual(setBrowser.mock.calls[1].arguments[0], fakeBrowser);
    assert.strictEqual(setContext.mock.callCount(), 1);
    assert.strictEqual(clearContext.mock.callCount(), 1);
    assert.strictEqual(init.mock.callCount(), 1);
    assert.ok(result.mode);

    resetMock.mock.restore();
    getInstanceMock.mock.restore();
  });

  it('clears the previous browser and context before a new connection can fail', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        throw new Error('connection failed');
      },
    }));
    let browser: unknown = {isConnected: () => true};
    let context: unknown = {pages: () => [{}]};
    const contextProvider = {
      setBrowser(value: unknown) {
        browser = value;
      },
      clearContext() {
        context = null;
      },
    };

    try {
      await assert.rejects(() =>
        connectBrowser(contextProvider as never, {channel: 'stable'}),
      );
      assert.strictEqual(browser, null);
      assert.strictEqual(context, null);
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('explicitly clears context when the new browser has none', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const fakeBrowser = {contexts: () => []};
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => fakeBrowser,
      getContext: () => null,
    }));
    const clearContext = mock.fn();
    const contextProvider = {
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext,
      init: async () => undefined,
    };

    try {
      await connectBrowser(contextProvider as never, {channel: 'stable'});
      assert.strictEqual(clearContext.mock.callCount(), 2);
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('retries failed connection attempts before succeeding', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    let attempts = 0;
    const fakeBrowser = {
      contexts: () => [{pages: () => []}],
      isConnected: () => true,
      version: () => 'test',
    };
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient failure');
        return fakeBrowser;
      },
      getContext: () => fakeBrowser.contexts()[0],
    }));
    const contextProvider = {
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    try {
      const result = await connectBrowser(
        contextProvider as never,
        {channel: 'stable'},
        {maxRetries: 3, initialDelayMs: 1},
      );
      assert.strictEqual(attempts, 3);
      assert.deepStrictEqual(result, {connected: true, mode: 'launch'});
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('throws the last error after exhausting all retries', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    let attempts = 0;
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        attempts += 1;
        throw new Error(`connect-failed-${attempts}`);
      },
    }));
    const contextProvider = {
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    try {
      await assert.rejects(
        connectBrowser(
          contextProvider as never,
          {channel: 'stable'},
          {maxRetries: 2, initialDelayMs: 1},
        ),
        (error: unknown) =>
          error instanceof Error && error.message === 'connect-failed-2',
      );
      assert.strictEqual(attempts, 2);
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('applies exponential backoff between retries', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        throw new Error('still failing');
      },
    }));
    const contextProvider = {
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    // @ts-expect-error spy on global setTimeout to capture delays
    globalThis.setTimeout = (
      handler: (...args: unknown[]) => void,
      ms: number,
      ...rest: unknown[]
    ) => {
      delays.push(ms);
      return originalSetTimeout(handler, ms, ...rest);
    };

    try {
      await assert.rejects(() =>
        connectBrowser(
          contextProvider as never,
          {channel: 'stable'},
          {maxRetries: 3, initialDelayMs: 200},
        ),
      );
      assert.deepStrictEqual(delays, [200, 400]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('does not retry by default when connecting to a remote browser', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    let attempts = 0;
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        attempts += 1;
        throw new Error('remote connect failed');
      },
    }));
    const contextProvider = {
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    try {
      await assert.rejects(
        connectBrowser(contextProvider as never, {
          browserURL: 'http://127.0.0.1:9222',
        }),
        (error: unknown) =>
          error instanceof Error && error.message === 'remote connect failed',
      );
      assert.strictEqual(attempts, 1);
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('disconnectBrowser resets instance and clears contextProvider browser', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(),
    );

    const setBrowser = mock.fn();
    const clearContext = mock.fn();
    const contextProvider = {setBrowser, clearContext};

    await disconnectBrowser(contextProvider as never);

    assert.strictEqual(resetMock.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.calls[0].arguments[0], null);
    assert.strictEqual(clearContext.mock.callCount(), 1);

    resetMock.mock.restore();
  });

  it('force disconnect bypasses an active tool guard', async () => {
    let releaseTool!: () => void;
    const toolGate = new Promise<void>(resolve => {
      releaseTool = resolve;
    });
    const running = workerActivityCoordinator.runTool(async () => {
      await toolGate;
    });
    let markDisconnectStarted!: () => void;
    const disconnectStarted = new Promise<void>(resolve => {
      markDisconnectStarted = resolve;
    });
    let releaseDisconnect!: () => void;
    const disconnectGate = new Promise<void>(resolve => {
      releaseDisconnect = resolve;
    });
    const resetMock = mock.method(BrowserManager, 'resetInstance', async () => {
      markDisconnectStarted();
      await disconnectGate;
    });
    const setBrowser = mock.fn();
    const clearContext = mock.fn();
    const disconnect = disconnectBrowser as (
      contextProvider: never,
      options?: {force?: boolean},
    ) => Promise<void>;

    let forcedDisconnect: Promise<void> | undefined;
    try {
      forcedDisconnect = disconnect({setBrowser, clearContext} as never, {
        force: true,
      });
      await disconnectStarted;
      assert.strictEqual(
        workerActivityCoordinator.getState().browserOperation,
        'disconnect',
      );
      await assert.rejects(
        workerActivityCoordinator.runTool(async () => undefined),
        (error: unknown) => (error as {code?: string}).code === 'WORKER_BUSY',
      );
      releaseDisconnect();
      await forcedDisconnect;
      assert.strictEqual(resetMock.mock.callCount(), 1);
      assert.strictEqual(setBrowser.mock.callCount(), 1);
      assert.strictEqual(clearContext.mock.callCount(), 1);
    } finally {
      releaseDisconnect();
      await forcedDisconnect?.catch(() => undefined);
      releaseTool();
      await running;
      resetMock.mock.restore();
    }
  });

  it('reuses existing connected browser without reset when force is not specified', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const fakeBrowser = {
      isConnected: () => true,
    };
    const contextProvider = {
      isBrowserConnected: () => true,
      getBrowser: () => fakeBrowser,
    };

    try {
      const result = await connectBrowser(contextProvider as never, {
        browserURL: 'http://127.0.0.1:9222',
      });
      assert.strictEqual(resetMock.mock.callCount(), 0);
      assert.deepStrictEqual(result, {connected: true, mode: 'attach'});
    } finally {
      resetMock.mock.restore();
    }
  });

  it('forces reconnect and resets instance when force: true is specified even if connected', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const fakeBrowser = {
      contexts: () => [{pages: () => []}],
      isConnected: () => true,
    };
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => fakeBrowser,
      getContext: () => fakeBrowser.contexts()[0],
    }));
    const contextProvider = {
      isBrowserConnected: () => true,
      getBrowser: () => fakeBrowser,
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    try {
      const result = await connectBrowser(
        contextProvider as never,
        {browserURL: 'http://127.0.0.1:9222'},
        {force: true},
      );
      assert.strictEqual(resetMock.mock.callCount(), 1);
      assert.deepStrictEqual(result, {connected: true, mode: 'attach'});
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('triggers reconnect when connected browser target changes even without force', async () => {
    const resetMock = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const fakeBrowser = {
      contexts: () => [{pages: () => []}],
      isConnected: () => true,
    };
    const getInstanceMock = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => fakeBrowser,
      getContext: () => fakeBrowser.contexts()[0],
    }));
    const contextProvider = {
      isBrowserConnected: () => true,
      getBrowser: () => fakeBrowser,
      getBrowserManager: () => ({
        getConfig: () => ({browserURL: 'http://127.0.0.1:9222'}),
      }),
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    try {
      const result = await connectBrowser(
        contextProvider as never,
        {browserURL: 'http://127.0.0.1:9223'}, // target changed: 9222 -> 9223
      );
      assert.strictEqual(resetMock.mock.callCount(), 1);
      assert.strictEqual(getInstanceMock.mock.callCount(), 1);
      assert.deepStrictEqual(result, {connected: true, mode: 'attach'});
    } finally {
      resetMock.mock.restore();
      getInstanceMock.mock.restore();
    }
  });

  it('correctly compares browser target configurations with isSameBrowserTarget', () => {
    // attach
    assert.strictEqual(
      isSameBrowserTarget(
        {browserURL: 'http://127.0.0.1:9222'},
        {browserURL: 'http://127.0.0.1:9222'},
      ),
      true,
    );
    assert.strictEqual(
      isSameBrowserTarget(
        {browserURL: 'http://127.0.0.1:9222'},
        {browserURL: 'http://127.0.0.1:9223'},
      ),
      false,
    );

    // mode mismatch: attach vs ws-endpoint
    assert.strictEqual(
      isSameBrowserTarget(
        {browserURL: 'http://127.0.0.1:9222'},
        {wsEndpoint: 'ws://127.0.0.1/devtools'},
      ),
      false,
    );

    // launch
    assert.strictEqual(
      isSameBrowserTarget(
        {channel: 'stable', headless: true},
        {channel: 'stable', headless: true},
      ),
      true,
    );
    assert.strictEqual(
      isSameBrowserTarget(
        {channel: 'stable', headless: true},
        {channel: 'canary', headless: true},
      ),
      false,
    );
  });

  it('gives ego its own connection identity (I1)', () => {
    // An ego config is its own mode, not 'launch': otherwise a connected local
    // launch would swallow a `{ego: true}` request and the bridge would never start.
    assert.strictEqual(getBrowserConnectionMode({ego: true}), 'ego');
    assert.notStrictEqual(getBrowserConnectionMode({ego: true}), 'launch');

    // An ego config and a launch config are never the same target, even when both
    // look like "no endpoint yet".
    assert.strictEqual(
      isSameBrowserTarget({ego: true}, {channel: 'stable', headless: true}),
      false,
    );
    assert.strictEqual(isSameBrowserTarget({ego: true}, {}), false);
    // Nor is ego the same target as an explicit ws endpoint.
    assert.strictEqual(
      isSameBrowserTarget({ego: true}, {wsEndpoint: 'ws://127.0.0.1/devtools'}),
      false,
    );
  });

  it('treats two ego configs for the same workspace as the same target (I1)', () => {
    // `connectEgoBrowser()` rewrites the live config's `wsEndpoint` with the
    // endpoint the bridge discovered, so the active config and the incoming one
    // never carry the same endpoint. Keying on the endpoint would make every
    // reconnect look like a target change → resetInstance() → stop() → the
    // agent's task space is destroyed.
    const active = {
      ego: true,
      wsEndpoint: 'ws://127.0.0.1:5599/devtools/browser/x',
    };
    assert.strictEqual(isSameBrowserTarget(active, {ego: true}), true);
    // Stable across the rewrite in either direction.
    assert.strictEqual(isSameBrowserTarget({ego: true}, active), true);
    // Repeated identical ego requests are idempotent.
    assert.strictEqual(isSameBrowserTarget({ego: true}, {ego: true}), true);
    assert.strictEqual(
      getBrowserConnectionMode(active),
      'ego',
      'a connected ego config must not be classified as ws-endpoint',
    );
  });

  it('reuses a live ego connection on a second connect without reset or stop (I1)', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(true),
    );
    const fakeBrowser = {
      contexts: () => [{pages: () => [{}]}],
      isConnected: () => true,
      version: () => 'test',
    };
    const activeConfig = {
      ego: true,
      wsEndpoint: 'ws://127.0.0.1:5599/devtools/browser/ego-test',
    };
    const contextProvider = {
      isBrowserConnected: () => true,
      getBrowser: () => fakeBrowser,
      getBrowserManager: () => ({getConfig: () => activeConfig}),
      getContext: () => fakeBrowser.contexts()[0],
      setBrowserManager: () => undefined,
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    const result = await connectBrowser(contextProvider as never, {
      ego: true,
    });

    assert.deepStrictEqual(result, {connected: true, mode: 'ego'});
    assert.strictEqual(
      resetMock.mock.callCount(),
      0,
      'a repeat ego connect must not reset the instance (that would stop the bridge)',
    );
    resetMock.mock.restore();
  });

  it('reports mode from active browser config when connected', () => {
    const status = getBrowserConnectionStatus(
      {
        isBrowserConnected: () => true,
        getContext: () => ({pages: () => [{}]}),
        getBrowserManager: () => ({
          getConfig: () => ({wsEndpoint: 'ws://127.0.0.1:9222/devtools'}),
        }),
      } as never,
      {browserURL: 'http://127.0.0.1:9222'}, // store has attach, but live manager is ws-endpoint
    );

    assert.deepEqual(status, {connected: true, mode: 'ws-endpoint', pages: 1});
  });
});
