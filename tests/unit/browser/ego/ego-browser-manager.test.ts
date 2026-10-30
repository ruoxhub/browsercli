/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * `BrowserManager` in ego mode: the bridge is the transport.
 *
 * Ego lite exposes no debugging port, so `config.ego` must make the manager
 * start `EgoBridgeManager`, publish the bridged endpoint as its ws endpoint and
 * then go through the *existing* remote-connect verification path. Nothing here
 * launches a browser: `chromium.launch` is booby-trapped, and every assertion
 * about the bridge goes through an injected fake (`EgoBridgeManager.getInstance`
 * replaced, the same way the sibling tests replace `chromium.*`).
 *
 * The lifecycle rules covered here are the ones that leak a bridge in
 * production: a failed `start()`, a failed `connectOverCDP()` after a successful
 * `start()`, and `close()` forgetting to stop what it started.
 */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {chromium} from 'patchright';

import {
  EgoBridgeManager,
  type EgoBridgeConnection,
} from '../../../../src/modules/browser/ego/EgoBridgeManager.js';
import {BrowserManager} from '../../../../src/modules/browser/index.js';
import {connectBrowser} from '../../../../src/worker/BrowserConnectionManager.js';

interface FakePage {
  id: string;
  setViewportSize(size: unknown): Promise<void>;
  isClosed(): boolean;
  once(event: string, handler: () => void): void;
}

interface FakeContext {
  pages(): FakePage[];
  newCDPSession(page: FakePage): Promise<{
    send(method: string): Promise<{bounds: Record<string, number>}>;
    detach(): Promise<void>;
  }>;
}

interface FakeBrowser {
  isConnected(): boolean;
  version(): string;
  contexts(): FakeContext[];
  on(event: string, handler: unknown): void;
  close(): Promise<void>;
}

/** The pinned `EgoBridgeManager` surface, with observable call counters. */
interface FakeBridge {
  endpoint: string;
  startCalls: number;
  stopCalls: number;
  running: boolean;
  failure: Error | undefined;
  start(options?: {keepPage?: boolean}): Promise<EgoBridgeConnection>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

function makePage(id: string): FakePage {
  let closed = false;
  return {
    id,
    setViewportSize: async () => {
      closed = false;
    },
    isClosed: () => closed,
    once: () => undefined,
  };
}

function makeContext(pages: FakePage[]): FakeContext {
  return {
    pages: () => pages,
    newCDPSession: async () => ({
      send: async () => ({bounds: {width: 1280, height: 720, left: 0, top: 0}}),
      detach: async () => undefined,
    }),
  };
}

function makeBrowser(
  contexts: FakeContext[],
  counters: {closes: number} = {closes: 0},
): FakeBrowser {
  return {
    isConnected: () => true,
    version: () => 'Chrome/141.0.7390.0',
    contexts: () => contexts,
    on: () => undefined,
    close: async () => {
      counters.closes += 1;
    },
  };
}

function makeBridge(): FakeBridge {
  return {
    endpoint: 'ws://127.0.0.1:5599/devtools/browser/ego-test',
    startCalls: 0,
    stopCalls: 0,
    running: false,
    failure: undefined,
    async start() {
      this.startCalls += 1;
      if (this.failure) throw this.failure;
      this.running = true;
      return {wsEndpoint: this.endpoint, childPid: 4242};
    },
    async stop() {
      this.stopCalls += 1;
      this.running = false;
    },
    isRunning: () => false,
  };
}

describe('BrowserManager ego mode', () => {
  let originalGetInstance: typeof EgoBridgeManager.getInstance;
  let originalConnect: typeof chromium.connectOverCDP;
  let originalLaunch: typeof chromium.launch;
  let launchCalls: number;

  beforeEach(async () => {
    await BrowserManager.resetInstance();
    originalGetInstance = EgoBridgeManager.getInstance;
    originalConnect = chromium.connectOverCDP;
    originalLaunch = chromium.launch;
    launchCalls = 0;
    // Ego mode must never start a local browser; a stray launch is a bug, not
    // a slow test.
    chromium.launch = (async () => {
      launchCalls += 1;
      throw new Error('ego mode must not launch a local browser');
    }) as typeof chromium.launch;
  });

  afterEach(async () => {
    try {
      await BrowserManager.resetInstance();
    } catch {
      // no-op: a test may leave a deliberately broken manager
    }
    EgoBridgeManager.getInstance = originalGetInstance;
    chromium.connectOverCDP = originalConnect;
    chromium.launch = originalLaunch;
  });

  /** Install `bridge` as the singleton the manager will ask for. */
  function useBridge(bridge: FakeBridge): void {
    EgoBridgeManager.getInstance = (() =>
      bridge) as unknown as typeof EgoBridgeManager.getInstance;
  }

  /** Point `connectOverCDP` at `browser` and record the endpoints asked for. */
  function connectTo(browser: FakeBrowser): string[] {
    const endpoints: string[] = [];
    chromium.connectOverCDP = (async (endpoint: string) => {
      endpoints.push(endpoint);
      return browser;
    }) as unknown as typeof chromium.connectOverCDP;
    return endpoints;
  }

  function egoManager(): BrowserManager {
    return BrowserManager.getInstance({
      ego: true,
      headless: true,
      isolated: true,
    });
  }

  it('starts the bridge once and connects with its wsEndpoint', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    const page = makePage('ego-tab');
    const browser = makeBrowser([makeContext([page])]);
    const endpoints = connectTo(browser);

    const manager = egoManager();
    const connected = await manager.ensureBrowser();

    assert.strictEqual(connected, browser as unknown as typeof connected);
    assert.equal(
      bridge.startCalls,
      1,
      'the bridge must be started exactly once',
    );
    assert.deepEqual(endpoints, [bridge.endpoint]);
    assert.equal(manager.getConfig().wsEndpoint, bridge.endpoint);
    assert.equal(manager.getCurrentPage(), page as never);
    assert.equal(launchCalls, 0, 'ego mode must not launch a local browser');
  });

  it('reuses the connection on a second ensureBrowser without a second bridge', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    const browser = makeBrowser([makeContext([makePage('ego-tab')])]);
    const endpoints = connectTo(browser);

    const manager = egoManager();
    const first = await manager.ensureBrowser();
    const second = await manager.ensureBrowser();

    assert.strictEqual(first, second);
    assert.equal(bridge.startCalls, 1);
    assert.equal(endpoints.length, 1);
    assert.equal(launchCalls, 0);
  });

  it('propagates a bridge start failure and stops the bridge it did not get', async () => {
    const bridge = makeBridge();
    bridge.failure = new Error('ego lite is not installed');
    useBridge(bridge);
    const endpoints = connectTo(makeBrowser([makeContext([makePage('x')])]));

    const manager = egoManager();
    await assert.rejects(manager.ensureBrowser(), /ego lite is not installed/);

    assert.equal(bridge.startCalls, 1);
    assert.equal(
      bridge.stopCalls,
      1,
      'a failed start must not leak the bridge',
    );
    assert.equal(endpoints.length, 0, 'no endpoint, no connect');
    assert.equal(manager.getBrowser(), null);

    // Retryable: the failed launch must not be cached as a result.
    bridge.failure = undefined;
    const browser = makeBrowser([makeContext([makePage('ego-tab')])]);
    connectTo(browser);
    const connected = await manager.ensureBrowser();
    assert.strictEqual(connected, browser as unknown as typeof connected);
    assert.equal(bridge.startCalls, 2);
  });

  it('stops the bridge when connectOverCDP fails after a successful start', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    chromium.connectOverCDP = (async () => {
      throw new Error('bridge handshake failed');
    }) as unknown as typeof chromium.connectOverCDP;

    const manager = egoManager();
    await assert.rejects(
      manager.ensureBrowser(),
      /Failed to connect to remote browser: bridge handshake failed/,
    );

    assert.equal(bridge.startCalls, 1);
    assert.equal(
      bridge.stopCalls,
      1,
      'the bridge must not outlive a failed connect',
    );
    assert.equal(bridge.running, false);
    assert.equal(manager.getBrowser(), null);

    // Retryable: the next attempt starts a fresh bridge and connects.
    const browser = makeBrowser([makeContext([makePage('ego-tab')])]);
    const endpoints = connectTo(browser);
    const connected = await manager.ensureBrowser();
    assert.strictEqual(connected, browser as unknown as typeof connected);
    assert.equal(bridge.startCalls, 2);
    assert.deepEqual(endpoints, [bridge.endpoint]);
  });

  it('stops the bridge in close() when the manager owns one', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    const counters = {closes: 0};
    const browser = makeBrowser([makeContext([makePage('ego-tab')])], counters);
    connectTo(browser);

    const manager = egoManager();
    await manager.ensureBrowser();
    await manager.close();

    assert.equal(bridge.stopCalls, 1, 'close() must stop the ego bridge');
    assert.equal(counters.closes, 1, 'the CDP connection is closed too');
    assert.equal(bridge.running, false);
  });

  it('does not stop any bridge in close() outside ego mode', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    const counters = {closes: 0};
    const browser = makeBrowser(
      [makeContext([makePage('local-tab')])],
      counters,
    );
    chromium.launch = (async () => {
      launchCalls += 1;
      return browser;
    }) as unknown as typeof chromium.launch;

    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    await manager.ensureBrowser();
    assert.equal(
      launchCalls,
      1,
      'the local launch path must stay the launch path',
    );

    await manager.close();

    assert.equal(counters.closes, 1);
    assert.equal(
      bridge.stopCalls,
      0,
      'a non-ego close must never stop a bridge',
    );
    assert.equal(bridge.startCalls, 0);
  });

  it('binds a page from the bridge context even when the first context is empty', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    const bridgePage = makePage('ego-task-tab');
    const emptyContext = makeContext([]);
    const bridgeContext = makeContext([bridgePage]);
    const browser = makeBrowser([emptyContext, bridgeContext]);
    connectTo(browser);

    const manager = egoManager();
    const notified: unknown[] = [];
    manager.onReconnected = (_browser, context) => {
      notified.push(context);
    };
    await manager.ensureBrowser();

    assert.equal(manager.getCurrentPage(), bridgePage as never);
    assert.equal(manager.getContext(), bridgeContext as never);
    assert.equal(launchCalls, 0);
    // The last notification must name the context that is actually bound. The
    // remote-connect path notifies first with `contexts()[0]` — the empty one this
    // binding exists to replace — so a provider that only saw that first call
    // would keep an empty context while the manager holds the page.
    assert.equal(
      notified.at(-1),
      bridgeContext as never,
      'subscribers must end up on the context the manager bound',
    );
  });

  it('a second connect while the ego bridge is live reuses it (no reset, no stop)', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    connectTo(makeBrowser([makeContext([makePage('ego-tab')])]));

    let manager: BrowserManager | null = null;
    const contextProvider = {
      isBrowserConnected: () => manager?.isConnected() ?? false,
      getBrowser: () => manager?.getBrowser() ?? null,
      getBrowserManager: () => manager,
      getContext: () => manager?.getContext() ?? null,
      setBrowserManager: (next: BrowserManager) => {
        manager = next;
      },
      setBrowser: () => undefined,
      setContext: () => undefined,
      clearContext: () => undefined,
      init: async () => undefined,
    };

    const first = await connectBrowser(contextProvider as never, {ego: true});
    // The live config now carries the discovered endpoint; the incoming one never
    // does. The target identity must survive that rewrite.
    assert.equal(manager?.getConfig().wsEndpoint, bridge.endpoint);

    const second = await connectBrowser(contextProvider as never, {ego: true});

    assert.deepEqual(first, {connected: true, mode: 'ego'});
    assert.deepEqual(second, {connected: true, mode: 'ego'});
    assert.equal(bridge.startCalls, 1, 'no second bridge');
    assert.equal(
      bridge.stopCalls,
      0,
      'a repeat connect must not tear the bridge (and its task space) down',
    );
    assert.equal(
      BrowserManager.getInstance(),
      manager,
      'the instance must not be recreated',
    );
  });

  it('keeps the manager when a failed close cannot stop the bridge (I2)', async () => {
    const bridge = makeBridge();
    useBridge(bridge);
    connectTo(makeBrowser([makeContext([makePage('ego-tab')])]));

    const manager = egoManager();
    await manager.ensureBrowser();

    // The first teardown fails: the bridge stays alive, so the claim must survive.
    const realStop = bridge.stop.bind(bridge);
    let stopAttempts = 0;
    bridge.stop = async () => {
      stopAttempts += 1;
      if (stopAttempts === 1) throw new Error('bridge did not stop');
      await realStop();
    };

    assert.equal(
      await BrowserManager.resetInstance(),
      false,
      'a failed close must be reported, not hidden',
    );
    assert.equal(
      BrowserManager.getInstance(),
      manager,
      'the manager holds the only claim that can retry the teardown',
    );
    assert.equal(
      manager.isConnected(),
      false,
      'it no longer reports connected',
    );
    assert.equal(stopAttempts, 1);

    // The retry that the comment promises actually happens.
    assert.equal(await BrowserManager.resetInstance(), true);
    assert.equal(stopAttempts, 2, 'the retry really stopped the bridge');
    assert.equal(bridge.running, false);
    assert.throws(
      () => BrowserManager.getInstance(),
      /must be initialized with config/,
      'only a successful teardown drops the instance',
    );
  });
});
