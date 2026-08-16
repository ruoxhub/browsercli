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
});
