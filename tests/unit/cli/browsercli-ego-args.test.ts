/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Task 4 wiring: `--ego` / `--keep-page` from the CLI all the way to
 * `EgoBridgeManager.start({keepPage})`.
 *
 * Nothing here launches a browser: the bridge is an injected fake and
 * `chromium.connectOverCDP` is replaced, the same way the sibling ego tests do
 * it. The point is the *plumbing* — parser → IPC request schema → manager config
 * → bridge start options — because each of those layers drops an unknown field
 * silently (a closed flag set, a `.strict()` request schema, a `.strip()` config
 * schema).
 */

import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {AxiError} from 'axi-sdk-js';
import {chromium} from 'patchright';

import {browserCommand} from '../../../src/cli/commands/browser.js';
import type {DaemonEvent, DaemonLike} from '../../../src/cli/daemonClient.js';
import type {WorkerContext} from '../../../src/cli/types.js';
import {
  EgoBridgeManager,
  type EgoBridgeConnection,
  type EgoBridgeStartOptions,
} from '../../../src/modules/browser/ego/EgoBridgeManager.js';
import {BrowserManager} from '../../../src/modules/browser/index.js';
import {connectBrowser} from '../../../src/worker/BrowserConnectionManager.js';
import {parseBrowserConnectBody} from '../../../src/worker/browserRequests.js';

/** A daemon client that records the `browser.connect` body and nothing else. */
function recordingContext(): {
  bodies: Array<Record<string, unknown>>;
  ctx: WorkerContext;
} {
  const bodies: Array<Record<string, unknown>> = [];
  const client: DaemonLike = {
    async request<T>(method: string, params?: Record<string, unknown>) {
      if (method === 'browser.connect') {
        bodies.push((params?.body ?? {}) as Record<string, unknown>);
      }
      return {
        connected: true,
        mode: 'ego',
        pages: 0,
      } as T;
    },
    onEvent(_cb: (event: DaemonEvent) => void) {
      return () => undefined;
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() {},
  };
  return {bodies, ctx: {session: 'default', connect: async () => client}};
}

describe('browser connect --ego / --keep-page parsing', () => {
  it('maps --ego and --keep-page to the connect body', async () => {
    const {bodies, ctx} = recordingContext();
    await browserCommand(['connect', '--ego', '--keep-page'], ctx);

    assert.deepEqual(bodies, [{ego: true, keepPage: true}]);
  });

  it('maps --ego alone and honours an explicit =false', async () => {
    const egoOnly = recordingContext();
    await browserCommand(['connect', '--ego'], egoOnly.ctx);
    assert.deepEqual(egoOnly.bodies, [{ego: true}]);

    const disabled = recordingContext();
    await browserCommand(['connect', '--ego=false'], disabled.ctx);
    assert.deepEqual(disabled.bodies, [{ego: false}]);
  });

  it('rejects --keep-page without --ego instead of silently ignoring it', async () => {
    const cases = [
      ['connect', '--keep-page'],
      // An explicit `--ego=false` does not select ego mode either.
      ['connect', '--ego=false', '--keep-page'],
    ];
    for (const args of cases) {
      const {bodies, ctx} = recordingContext();
      await assert.rejects(
        async () => browserCommand(args, ctx),
        (error: unknown) => {
          assert.ok(
            error instanceof AxiError,
            `expected an AxiError for ${args.join(' ')}`,
          );
          assert.strictEqual(error.code, 'VALIDATION_ERROR');
          assert.match(error.message, /--keep-page/);
          assert.match(error.message, /--ego/);
          return true;
        },
        args.join(' '),
      );
      assert.deepEqual(bodies, [], 'nothing may reach the daemon');
    }
  });

  it('keeps the existing non-ego surface unchanged', async () => {
    const {bodies, ctx} = recordingContext();
    await browserCommand(['connect', '--channel', 'stable', '--cloak'], ctx);
    assert.deepEqual(bodies, [{channel: 'stable', cloak: true}]);
  });
});

// ─── CLI body → IPC schema → BrowserManager → EgoBridgeManager.start ─────────

interface FakeBridge {
  endpoint: string;
  startOptions: Array<EgoBridgeStartOptions | undefined>;
  start(options?: EgoBridgeStartOptions): Promise<EgoBridgeConnection>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

function makeBridge(): FakeBridge {
  const startOptions: Array<EgoBridgeStartOptions | undefined> = [];
  return {
    endpoint: 'ws://127.0.0.1:5599/devtools/browser/ego-test',
    startOptions,
    async start(options?: EgoBridgeStartOptions) {
      startOptions.push(options);
      return {wsEndpoint: this.endpoint, childPid: 4242};
    },
    async stop() {
      // no-op
    },
    isRunning: () => false,
  };
}

describe('CLI flags reach EgoBridgeManager.start', () => {
  let originalGetInstance: typeof EgoBridgeManager.getInstance;
  let originalConnect: typeof chromium.connectOverCDP;
  let originalLaunch: typeof chromium.launch;

  beforeEach(async () => {
    await BrowserManager.resetInstance();
    originalGetInstance = EgoBridgeManager.getInstance;
    originalConnect = chromium.connectOverCDP;
    originalLaunch = chromium.launch;
    chromium.launch = (async () => {
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

  /** Run the CLI, take the body it would send, and connect through the IPC schema. */
  async function connectThroughCli(args: string[]): Promise<FakeBridge> {
    const {bodies, ctx} = recordingContext();
    await browserCommand(args, ctx);
    const body = bodies[0];
    assert.ok(body, 'the CLI must have sent a connect body');

    // The daemon's own path: `.strict()` request schema → manager config.
    const patch = parseBrowserConnectBody(body);

    const bridge = makeBridge();
    EgoBridgeManager.getInstance = (() =>
      bridge) as unknown as typeof EgoBridgeManager.getInstance;
    const page = {
      setViewportSize: async () => undefined,
      once: () => undefined,
    };
    const fakeBrowser = {
      isConnected: () => true,
      version: () => 'Chrome/141.0.7390.0',
      contexts: () => [{pages: () => [page]}],
      on: () => undefined,
      close: async () => undefined,
    };
    chromium.connectOverCDP = (async () =>
      fakeBrowser) as unknown as typeof chromium.connectOverCDP;

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

    const result = await connectBrowser(
      contextProvider as never,
      patch as never,
    );
    assert.deepEqual(result, {connected: true, mode: 'ego'});
    return bridge;
  }

  it('passes --keep-page to start({keepPage: true})', async () => {
    const bridge = await connectThroughCli(['connect', '--ego', '--keep-page']);
    assert.equal(bridge.startOptions.length, 1);
    assert.equal(bridge.startOptions[0]?.keepPage, true);
  });

  it('starts ego without retention when --keep-page is absent', async () => {
    const bridge = await connectThroughCli(['connect', '--ego']);
    assert.equal(bridge.startOptions.length, 1);
    assert.notEqual(bridge.startOptions[0]?.keepPage, true);
  });
});
