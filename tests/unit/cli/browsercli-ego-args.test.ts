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

  it('treats --keep-page alone as ego, because ego is the default source', async () => {
    // ego lite 是默认浏览器来源，所以 `--keep-page` 单独出现时不再自相矛盾：
    // CLI 把它和隐式 ego 一起下发。真正需要拒绝的只剩显式关掉 ego 的情形。
    const {bodies, ctx} = recordingContext();
    await browserCommand(['connect', '--keep-page'], ctx);
    assert.deepEqual(
      bodies,
      [{ego: true, keepPage: true}],
      'the implicit default must travel with the flag that needs it',
    );
  });

  it('rejects --keep-page when ego is explicitly switched off', async () => {
    // `--ego=false` 明确要求非 ego 模式，此时 keepPage 不会被任何分支读取，
    // 仍然属于「写明了却静默忽略」，必须拒绝。
    const {bodies, ctx} = recordingContext();
    await assert.rejects(
      async () =>
        browserCommand(['connect', '--ego=false', '--keep-page'], ctx),
      (error: unknown) => {
        assert.ok(error instanceof AxiError, 'expected an AxiError');
        assert.strictEqual(error.code, 'VALIDATION_ERROR');
        assert.match(error.message, /--keep-page/);
        assert.match(error.message, /--ego/);
        return true;
      },
    );
    assert.deepEqual(bodies, [], 'nothing may reach the daemon');
  });

  it('rejects the env-only BROWSER_KEEP_PAGE when ego is switched off', async () => {
    // 同一个「不许静默忽略」规则的环境变量版本。ego 默认开启后，只有显式
    // 关掉 ego 的组合才继续构成矛盾。
    const saved = process.env.BROWSER_KEEP_PAGE;
    const savedEgo = process.env.BROWSER_EGO;
    process.env.BROWSER_KEEP_PAGE = '1';
    process.env.BROWSER_EGO = 'false';
    try {
      const {bodies, ctx} = recordingContext();
      await assert.rejects(
        async () => browserCommand(['connect'], ctx),
        (error: unknown) => {
          assert.ok(error instanceof AxiError);
          assert.strictEqual(error.code, 'VALIDATION_ERROR');
          assert.match(error.message, /keepPage/);
          assert.match(error.message, /BROWSER_KEEP_PAGE/);
          assert.match(error.message, /BROWSER_EGO/);
          return true;
        },
      );
      assert.deepEqual(bodies, [], 'nothing may reach the daemon');
    } finally {
      if (saved === undefined) delete process.env.BROWSER_KEEP_PAGE;
      else process.env.BROWSER_KEEP_PAGE = saved;
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
    }
  });

  it('accepts --keep-page when BROWSER_EGO selects the mode (I1)', async () => {
    // This asserts only what the CLI can see: it does not reject locally, and it
    // sends `{keepPage:true}`. The daemon inherits BROWSER_EGO, so the body alone
    // does not describe the request — the real acceptance of exactly this body is
    // covered end to end (real handler, real socket) by `accepts connect
    // --keep-page when BROWSER_EGO supplies the mode (B3)` in
    // tests/unit/ipc/daemonServer.test.ts. A fake daemon here cannot see a
    // request-layer refusal, which is why that test exists.
    const saved = process.env.BROWSER_EGO;
    process.env.BROWSER_EGO = 'true';
    try {
      const {bodies, ctx} = recordingContext();
      await browserCommand(['connect', '--keep-page'], ctx);
      assert.deepEqual(bodies, [{keepPage: true}]);
    } finally {
      if (saved === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = saved;
    }
  });

  it('rejects --ego combined with each mutually exclusive target (I2)', async () => {
    // `BROWSER_CONNECT_USAGE` lists `[... | --ego]`, i.e. ego is one of the
    // mutually exclusive members of the target group. `ensureBrowser()` gives
    // ego priority, so an endpoint passed alongside it was silently dropped.
    const targetArgs = [
      ['--browser-url', 'http://127.0.0.1:9222'],
      ['--ws-endpoint', 'ws://127.0.0.1:1/x'],
      ['--channel', 'stable'],
      ['--executable-path', 'C:/browser.exe'],
    ];
    for (const target of targetArgs) {
      const args = ['connect', '--ego', ...target];
      const {bodies, ctx} = recordingContext();
      await assert.rejects(
        async () => browserCommand(args, ctx),
        (error: unknown) => {
          assert.ok(
            error instanceof AxiError,
            `expected an AxiError for ${args.join(' ')}`,
          );
          assert.strictEqual(error.code, 'VALIDATION_ERROR');
          assert.match(error.message, /--ego/);
          assert.match(error.message, new RegExp(target[0]));
          return true;
        },
        args.join(' '),
      );
      assert.deepEqual(bodies, [], 'nothing may reach the daemon');
    }

    // The valid shapes still work.
    const egoOnly = recordingContext();
    await browserCommand(['connect', '--ego'], egoOnly.ctx);
    assert.deepEqual(egoOnly.bodies, [{ego: true}]);

    const withKeepPage = recordingContext();
    await browserCommand(['connect', '--ego', '--keep-page'], withKeepPage.ctx);
    assert.deepEqual(withKeepPage.bodies, [{ego: true, keepPage: true}]);

    // `--ego=false` does not select the mode, so targets remain legal.
    const disabled = recordingContext();
    await browserCommand(
      ['connect', '--ego=false', '--ws-endpoint', 'ws://127.0.0.1:1/x'],
      disabled.ctx,
    );
    assert.deepEqual(disabled.bodies, [
      {ego: false, wsEndpoint: 'ws://127.0.0.1:1/x'},
    ]);
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

  it('passes --profile to start({profileId})', async () => {
    const bridge = await connectThroughCli([
      'connect',
      '--ego',
      '--profile',
      'Profile 7',
    ]);
    assert.equal(bridge.startOptions.length, 1);
    assert.equal(bridge.startOptions[0]?.profileId, 'Profile 7');
  });

  it('starts ego without a profile when --profile is absent', async () => {
    const bridge = await connectThroughCli(['connect', '--ego']);
    assert.equal(bridge.startOptions.length, 1);
    assert.equal(bridge.startOptions[0]?.profileId, undefined);
  });

  it('starts ego without retention when --keep-page is absent', async () => {
    const bridge = await connectThroughCli(['connect', '--ego']);
    assert.equal(bridge.startOptions.length, 1);
    assert.notEqual(bridge.startOptions[0]?.keepPage, true);
  });

  it('rejects every launch-only flag in ego mode, before any daemon call', async () => {
    // These are read only by `launchBrowser()`, which ego mode never reaches.
    // The list is spelled out one flag at a time because `booleans` is keyed by
    // CONFIG names (camelCase) while flags are kebab-case: a mismatch reads
    // `undefined` and silently disables the check rather than failing loudly.
    const launchOnly = [
      ['--cloak'],
      ['--headless'],
      ['--headless=false'],
      ['--user-data-dir', 'profile-dir'],
      ['--isolated'],
      ['--minimal-stealth'],
      ['--full-stealth-args'],
      ['--js-stealth'],
      ['--accept-insecure-certs'],
    ];
    for (const extra of launchOnly) {
      const args = ['connect', '--ego', ...extra];
      const {bodies, ctx} = recordingContext();
      await assert.rejects(
        async () => browserCommand(args, ctx),
        (error: unknown) => {
          assert.ok(
            error instanceof AxiError,
            `expected an AxiError for ${args.join(' ')}`,
          );
          assert.strictEqual(
            error.code,
            'VALIDATION_ERROR',
            `${args.join(' ')} must be rejected locally, not by the daemon`,
          );
          assert.match(error.message, /不生效|ego/);
          return true;
        },
        args.join(' '),
      );
      assert.deepEqual(bodies, [], 'nothing may reach the daemon');
    }
  });

  it('does not reject ego alone, ego with --keep-page, or a non-ego launch', async () => {
    // The guard must not fire on the absence of these flags. `--ego` alone and
    // `--ego --keep-page` are the supported shapes; a non-ego launch may carry
    // all of them because there `launchBrowser()` really does read them.
    for (const args of [
      ['connect', '--ego'],
      ['connect', '--ego', '--keep-page'],
      [
        'connect',
        '--cloak',
        '--headless=false',
        '--isolated',
        '--js-stealth',
        '--minimal-stealth',
      ],
    ]) {
      const {ctx} = recordingContext();
      try {
        await browserCommand(args, ctx);
      } catch (error) {
        assert.fail(
          `${args.join(' ')} must not be rejected, got: ${String((error as Error)?.message)}`,
        );
      }
    }
  });
});

/**
 * `--profile` follows the same three layers as `--keep-page`: CLI flag set →
 * IPC `.strict()` body → `EgoBridgeManager.start({profileId})`. Each one drops
 * an unknown field silently, so each gets its own assertion.
 */
describe('browser connect --profile', () => {
  it('maps --profile to the connect body', async () => {
    const {bodies, ctx} = recordingContext();
    await browserCommand(['connect', '--ego', '--profile', 'Profile 7'], ctx);

    assert.deepEqual(bodies, [{ego: true, egoProfile: 'Profile 7'}]);
  });

  it('treats --profile alone as ego, because ego is the default source', async () => {
    // `--profile` 只在 ego 的任务空间里有含义。ego 默认开启后它不再需要显式
    // `--ego` 陪伴，CLI 会把隐式 ego 一起下发。
    const {bodies, ctx} = recordingContext();
    await browserCommand(['connect', '--profile', 'Profile 7'], ctx);
    assert.deepEqual(bodies, [{ego: true, egoProfile: 'Profile 7'}]);
  });

  it('rejects --profile when ego is explicitly switched off', async () => {
    const {bodies, ctx} = recordingContext();
    await assert.rejects(
      async () =>
        browserCommand(
          ['connect', '--ego=false', '--profile', 'Profile 7'],
          ctx,
        ),
      (error: unknown) => {
        assert.ok(error instanceof AxiError);
        assert.strictEqual(error.code, 'VALIDATION_ERROR');
        assert.match(error.message, /egoProfile/);
        assert.match(error.message, /--profile/);
        assert.match(error.message, /BROWSER_EGO_PROFILE/);
        return true;
      },
    );
    assert.deepEqual(bodies, [], 'nothing may reach the daemon');
  });

  it('rejects the env-only BROWSER_EGO_PROFILE when ego is switched off', async () => {
    const savedProfile = process.env.BROWSER_EGO_PROFILE;
    const savedEgo = process.env.BROWSER_EGO;
    process.env.BROWSER_EGO_PROFILE = 'Profile 7';
    process.env.BROWSER_EGO = 'false';
    try {
      const {bodies, ctx} = recordingContext();
      await assert.rejects(
        async () => browserCommand(['connect'], ctx),
        (error: unknown) => {
          assert.ok(error instanceof AxiError);
          assert.strictEqual(error.code, 'VALIDATION_ERROR');
          assert.match(error.message, /egoProfile/);
          return true;
        },
      );
      assert.deepEqual(bodies, [], 'nothing may reach the daemon');
    } finally {
      if (savedProfile === undefined) delete process.env.BROWSER_EGO_PROFILE;
      else process.env.BROWSER_EGO_PROFILE = savedProfile;
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
    }
  });

  it('carries the profile through the IPC body schema', () => {
    const parsed = parseBrowserConnectBody({
      ego: true,
      egoProfile: 'Profile 7',
    });
    assert.equal(parsed.egoProfile, 'Profile 7');
  });
});
