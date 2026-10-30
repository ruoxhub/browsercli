/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import net from 'node:net';
import {describe, it, mock} from 'node:test';

import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
  RuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';
import {
  startDaemonServer,
  type DaemonDeps,
  type DaemonHandle,
} from '../../../src/ipc/daemonServer.js';
import {WsHub} from '../../../src/ipc/eventHub.js';
import {makePipePath} from '../../../src/ipc/registry.js';
import {
  PROTOCOL_VERSION,
  SocketConnection,
  type DaemonMessage,
} from '../../../src/ipc/socketConnection.js';
import {BrowserManager} from '../../../src/modules/browser/index.js';
import type {ToolMeta} from '../../../src/tools/tools-meta.js';
import {JobStore} from '../../../src/worker/JobStore.js';

interface Gate {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function createStubAdapter() {
  const pending: Gate[] = [];
  return {
    pending,
    executeTool: async (
      _meta: ToolMeta,
      params: Record<string, unknown>,
      _sessionId?: string,
      _signal?: AbortSignal,
    ): Promise<unknown> => {
      if (params.immediate !== undefined) {
        return params.immediate;
      }
      return new Promise((resolve, reject) => {
        pending.push({resolve: resolve as (v: unknown) => void, reject});
      });
    },
  };
}

class TestClient {
  private readonly messages: DaemonMessage[] = [];
  private readonly waiters: Array<() => void> = [];
  private nextId = 1;
  private constructor(private readonly conn: SocketConnection) {
    conn.onmessage = message => {
      this.messages.push(message);
      for (const wake of this.waiters.splice(0)) wake();
    };
  }

  static async connect(socketPath: string): Promise<TestClient> {
    const socket = net.connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    return new TestClient(new SocketConnection(socket));
  }

  async request(method: string, params?: Record<string, unknown>) {
    const id = this.nextId++;
    await this.conn.send({id, method, params});
    return id;
  }

  async waitFor(
    predicate: (message: DaemonMessage) => boolean,
    timeoutMs = 5_000,
  ): Promise<DaemonMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      assert.ok(Date.now() < deadline, 'timed out waiting for daemon message');
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  async responseFor(id: number): Promise<DaemonMessage> {
    return this.waitFor(message => message['id'] === id);
  }

  close(): void {
    this.conn.close();
  }
}

function stubMeta(name: string): ToolMeta {
  return {
    name,
    description: '',
    schema: {},
    argSpecs: {},
    modulePath: './stub.js',
    handlerName: 'stub',
  } as ToolMeta;
}

interface Fixture {
  deps: DaemonDeps;
  handle: DaemonHandle;
  adapter: ReturnType<typeof createStubAdapter>;
  jobStore: JobStore;
  stopCalls: {count: number};
}

/**
 * A contextProvider that satisfies `connectBrowser()` without touching a browser.
 *
 * `connectBrowser()` only ever calls these methods, so a plain object is enough.
 * `isBrowserConnected()` reports whatever manager `connectBrowser()` installed, so
 * the idempotent-reuse fast path never short-circuits the connect under test while
 * `browser.status` still sees the resulting mode.
 */
function createStubContextProvider(): DaemonDeps['contextProvider'] {
  let manager: {getConfig: () => unknown; isConnected: () => boolean} | null =
    null;
  return {
    isBrowserConnected: () => manager?.isConnected() === true,
    getBrowser: () => null,
    getBrowserManager: () => manager,
    getContext: () => ({pages: () => []}),
    setBrowser: () => undefined,
    setBrowserManager: (next: typeof manager) => {
      manager = next;
    },
    setContext: () => undefined,
    clearContext: () => {
      manager = null;
    },
    init: async () => undefined,
  } as unknown as DaemonDeps['contextProvider'];
}

/**
 * Booby-trap the browser lifecycle: a real `ensureBrowser()` would launch Chrome.
 * Every `browser.connect` test goes through these two statics.
 */
function stubBrowserManager(): {restore: () => void; configs: unknown[]} {
  const configs: unknown[] = [];
  const fakeBrowser = {
    isConnected: () => true,
    contexts: () => [{pages: () => []}],
  };
  const reset = mock.method(BrowserManager, 'resetInstance', async () => true);
  const getInstance = mock.method(
    BrowserManager,
    'getInstance',
    (config: unknown) => {
      configs.push(config);
      return {
        ensureBrowser: async () => fakeBrowser,
        getContext: () => fakeBrowser.contexts()[0],
        getBrowser: () => fakeBrowser,
        getConfig: () => config,
        isConnected: () => true,
      };
    },
  );
  return {
    configs,
    restore: () => {
      reset.mock.restore();
      getInstance.mock.restore();
    },
  };
}

async function startFixture(): Promise<Fixture> {
  const adapter = createStubAdapter();
  const jobStore = new JobStore();
  const stopCalls = {count: 0};
  const deps = {
    sessionName: 't',
    version: '9.9.9',
    startedAt: Date.now(),
    runtime: {contextProvider: {}, browserManager: {}},
    contextProvider: createStubContextProvider(),
    toolAdapter: adapter,
    jobStore,
    wsHub: new WsHub(),
    listToolsMeta: () => [stubMeta('alpha'), stubMeta('beta')],
    getToolMeta: (name: string) =>
      name === 'alpha' || name === 'echo' ? stubMeta(name) : undefined,
    onStop: async () => {
      stopCalls.count += 1;
    },
  } as unknown as DaemonDeps;
  const handle = await startDaemonServer(
    deps,
    makePipePath(cryptoRandom(), 't'),
  );
  return {deps, handle, adapter, jobStore, stopCalls};
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function withFixture(
  run: (fixture: Fixture, client: TestClient) => Promise<void>,
): Promise<void> {
  const fixture = await startFixture();
  const client = await TestClient.connect(fixture.handle.socketPath);
  try {
    await run(fixture, client);
  } finally {
    client.close();
    await fixture.handle.close();
  }
}

describe('daemonServer', () => {
  it('hello returns version/protocol/pid/session', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('hello');
      const response = await client.responseFor(id);
      assert.deepStrictEqual(response['error'], undefined);
      const result = response['result'] as Record<string, unknown>;
      assert.equal(result.version, '9.9.9');
      assert.equal(result.protocol, PROTOCOL_VERSION);
      assert.equal(result.pid, process.pid);
      assert.equal(result.session, 't');
    });
  });

  it('status returns full DaemonStatusResult with socketPath/startDate/args', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('status');
      const response = await client.responseFor(id);
      assert.deepStrictEqual(response['error'], undefined);
      const result = response['result'] as Record<string, unknown>;
      assert.equal(result.version, '9.9.9');
      assert.equal(result.protocol, PROTOCOL_VERSION);
      assert.equal(result.pid, process.pid);
      assert.equal(result.session, 't');
      assert.equal(result.socketPath, fixture.handle.socketPath);
      assert.ok(typeof result.startDate === 'string');
      assert.ok(typeof result.uptimeMs === 'number');
      assert.ok(Array.isArray(result.args));
    });
  });

  it('tools.list passes through listToolsMeta', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('tools.list');
      const response = await client.responseFor(id);
      const result = response['result'] as {tools: ToolMeta[]};
      assert.deepEqual(
        result.tools.map(tool => tool.name),
        ['alpha', 'beta'],
      );
    });
  });

  it('tool.invoke returns the job result and records a done job', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('tool.invoke', {
        tool: 'echo',
        params: {immediate: {echo: 'hi'}},
      });
      const response = await client.responseFor(id);
      assert.deepStrictEqual(response['result'], {echo: 'hi'});
      const jobs = fixture.jobStore.list();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, 'done');
      assert.deepEqual(jobs[0].result, {echo: 'hi'});
    });
  });

  it('second tool.invoke while busy gets WORKER_BUSY', async () => {
    await withFixture(async (fixture, client) => {
      const firstId = await client.request('tool.invoke', {
        tool: 'alpha',
        params: {},
      });
      const secondId = await client.request('tool.invoke', {
        tool: 'alpha',
        params: {immediate: true},
      });
      const second = await client.responseFor(secondId);
      const error = second['error'] as {code: string};
      assert.equal(error.code, 'WORKER_BUSY');
      fixture.adapter.pending[0].resolve({echo: 'first'});
      const first = await client.responseFor(firstId);
      assert.deepStrictEqual(first['result'], {echo: 'first'});
    });
  });

  it('client disconnect aborts the running job and cancels it', async () => {
    const fixture = await startFixture();
    const client = await TestClient.connect(fixture.handle.socketPath);
    try {
      await client.request('tool.invoke', {tool: 'alpha', params: {}});
      // 等 job 进入 running，再断线
      for (let i = 0; i < 100 && !fixture.jobStore.list()[0]; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      client.close();
      fixture.adapter.pending[0].reject(
        Object.assign(new Error('job cancelled'), {code: 'JOB_CANCELLED'}),
      );
      for (
        let i = 0;
        i < 100 && fixture.jobStore.list()[0].status !== 'cancelled';
        i++
      ) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const job = fixture.jobStore.list()[0];
      assert.equal(job.status, 'cancelled');
      assert.equal(job.error?.code, 'JOB_CANCELLED');
    } finally {
      await fixture.handle.close();
    }
  });

  it('unrelated client disconnect does not abort running job', async () => {
    const fixture = await startFixture();
    const client1 = await TestClient.connect(fixture.handle.socketPath);
    const client2 = await TestClient.connect(fixture.handle.socketPath);
    try {
      const invokeId = await client1.request('tool.invoke', {
        tool: 'alpha',
        params: {},
      });
      // 等 job 进入 running
      for (let i = 0; i < 100 && !fixture.jobStore.list()[0]; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      // client2 发送 status 请求并随后断开
      const statusId = await client2.request('status');
      await client2.responseFor(statusId);
      client2.close();

      // 等待确保 client2 的 close 事件已被服务端触发
      await new Promise(resolve => setTimeout(resolve, 50));

      // 验证 job 仍处于 running 状态，并未被 cancel
      const job = fixture.jobStore.list()[0];
      assert.equal(job.status, 'running');

      // client1 正常完成 job
      fixture.adapter.pending[0].resolve({success: true});
      const response = await client1.responseFor(invokeId);
      assert.deepStrictEqual(response['result'], {success: true});
      assert.equal(fixture.jobStore.list()[0].status, 'done');
    } finally {
      client1.close();
      client2.close();
      await fixture.handle.close();
    }
  });

  it('subscribe forwards wsHub broadcasts as event frames', async () => {
    await withFixture(async (fixture, client) => {
      const subId = await client.request('subscribe', {channels: ['log']});
      const subResponse = await client.responseFor(subId);
      assert.deepStrictEqual(subResponse['result'], {subscribed: ['log']});
      fixture.deps.wsHub.broadcast('log', {m: 1});
      const event = await client.waitFor(
        message => message['type'] === 'event',
      );
      assert.equal(event['channel'], 'log');
      assert.deepStrictEqual(event['payload'], {m: 1});
    });
  });

  it('stop replies ok then invokes onStop once', async () => {
    await withFixture(async (fixture, client) => {
      const id = await client.request('stop');
      const response = await client.responseFor(id);
      assert.equal(response['result'], 'ok');
      for (let i = 0; i < 100 && fixture.stopCalls.count === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(fixture.stopCalls.count, 1);
    });
  });

  it('browser.connect rejects the two silent-ignore shapes as validation errors', async () => {
    // The daemon socket is reachable without the CLI (panel, scripts), so the
    // invariant has to hold here too — and it must surface as a validation
    // error, not the generic BROWSER_CONNECT_FAILED wrapper that hides the cause.
    await withFixture(async (_fixture, client) => {
      const keepPageId = await client.request('browser.connect', {
        body: {keepPage: true},
      });
      const keepPage = await client.responseFor(keepPageId);
      const keepPageError = keepPage['error'] as {
        code?: string;
        message?: string;
      };
      assert.equal(keepPageError.code, 'VALIDATION');
      assert.match(keepPageError.message ?? '', /keepPage/);
      assert.match(keepPageError.message ?? '', /ego/);
      assert.strictEqual(keepPage['result'], undefined);

      const conflictId = await client.request('browser.connect', {
        body: {ego: true, wsEndpoint: 'ws://127.0.0.1:1/x'},
      });
      const conflict = await client.responseFor(conflictId);
      const conflictError = conflict['error'] as {
        code?: string;
        message?: string;
      };
      assert.equal(conflictError.code, 'BROWSER_CONFIG_CONFLICT');
      assert.match(conflictError.message ?? '', /ego/);
      assert.strictEqual(conflict['result'], undefined);
    });
  });

  it('connect --ego=false clears a stored keepPage, so the mode switch is not a dead end', async () => {
    // The store merges `browser` shallowly, so the `keepPage` from request one used
    // to survive request two and leave `{ego:false, keepPage:true}` — a pair the
    // invariant rejects, permanently: the only way out was a daemon restart. Both
    // routes out are checked here (`--ego=false` and an explicit target), because
    // `keepPage` and `egoProfile` are cleared by two different branches.
    const stub = stubBrowserManager();
    const savedEgo = process.env.BROWSER_EGO;
    delete process.env.BROWSER_EGO;
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        const firstId = await client.request('browser.connect', {
          body: {ego: true, keepPage: true, egoProfile: 'Profile 7'},
        });
        const first = await client.responseFor(firstId);
        assert.deepStrictEqual(
          first['error'],
          undefined,
          'the ego + keepPage + profile connect must be accepted',
        );

        const secondId = await client.request('browser.connect', {
          body: {ego: false},
        });
        const second = await client.responseFor(secondId);
        assert.deepStrictEqual(
          second['error'],
          undefined,
          'ego:false must clear the stored keepPage/egoProfile instead of being rejected',
        );
        const stored = getRuntimeConfigStore().get().browser ?? {};
        assert.strictEqual(stored.ego, false);
        assert.strictEqual(
          stored.keepPage,
          undefined,
          'the stale keepPage must not survive the merge',
        );
        assert.strictEqual(
          stored.egoProfile,
          undefined,
          'the stale egoProfile must not survive the merge',
        );

        // The seeded-ego pair still works, and status/disconnect keep reading the
        // effective config afterwards — the wedge this test used to cover.
        const statusId = await client.request('browser.status');
        const status = await client.responseFor(statusId);
        assert.deepStrictEqual(
          status['error'],
          undefined,
          'browser.status must keep working',
        );

        const disconnectId = await client.request('browser.disconnect', {
          body: {},
        });
        const disconnect = await client.responseFor(disconnectId);
        assert.deepStrictEqual(
          disconnect['error'],
          undefined,
          'browser.disconnect must keep working',
        );
      });
    } finally {
      stub.restore();
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
      resetRuntimeConfigStore({});
    }
  });

  it('a rejected connect leaves no trace: later status/disconnect still work (B1)', async () => {
    // Validating before committing is what makes this hold: a rejection must not
    // dirty the store, or every later browser.status / browser.disconnect would
    // throw and the daemon would be wedged until restart.
    const stub = stubBrowserManager();
    const savedEgo = process.env.BROWSER_EGO;
    delete process.env.BROWSER_EGO;
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        // Rejected at the request layer: `keepPage` without ego is the silent
        // no-op the invariant forbids.
        const rejectedId = await client.request('browser.connect', {
          body: {keepPage: true},
        });
        const rejected = await client.responseFor(rejectedId);
        const rejectedError = rejected['error'] as {
          code?: string;
          message?: string;
        };
        assert.equal(rejectedError.code, 'VALIDATION');
        assert.match(rejectedError.message ?? '', /keepPage/);

        const statusId = await client.request('browser.status');
        const status = await client.responseFor(statusId);
        assert.deepStrictEqual(
          status['error'],
          undefined,
          'browser.status must keep working after a rejected connect',
        );

        const disconnectId = await client.request('browser.disconnect', {
          body: {},
        });
        const disconnect = await client.responseFor(disconnectId);
        assert.deepStrictEqual(
          disconnect['error'],
          undefined,
          'browser.disconnect must keep working after a rejected connect',
        );

        // ...and the rejected request really left nothing behind.
        assert.strictEqual(
          getRuntimeConfigStore().get().browser?.keepPage,
          undefined,
        );
      });
    } finally {
      stub.restore();
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
      resetRuntimeConfigStore({});
    }
  });

  it('accepts `connect --keep-page` when BROWSER_EGO supplies the mode (B3)', async () => {
    // The exact daemon-side path of `BROWSER_EGO=true browsercli browser connect
    // --keep-page`: the CLI is env-aware and sends only `{keepPage:true}`, and the
    // daemon inherits BROWSER_EGO (spawnDaemon passes no `env` option). A body-only
    // request-layer check rejected this legal request; the CLI test could not see
    // it because it uses a fake daemon.
    const stub = stubBrowserManager();
    const savedEgo = process.env.BROWSER_EGO;
    process.env.BROWSER_EGO = 'true';
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        const id = await client.request('browser.connect', {
          body: {keepPage: true},
        });
        const response = await client.responseFor(id);
        assert.deepStrictEqual(
          response['error'],
          undefined,
          'env-derived ego must make keepPage legal',
        );
        const status = response['result'] as {mode?: string};
        assert.strictEqual(status.mode, 'ego');
        // The retention policy reached the manager config, not just the store.
        const connected = stub.configs.at(-1) as {
          ego?: boolean;
          keepPage?: boolean;
        };
        assert.strictEqual(connected.ego, true);
        assert.strictEqual(connected.keepPage, true);
      });
    } finally {
      stub.restore();
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
      resetRuntimeConfigStore({});
    }
  });

  it('browser.disconnect surfaces a config invariant instead of masking it', async () => {
    // Same masking the last round removed from handleBrowserConnect: folding
    // BrowserConfigInvariantError into BROWSER_DISCONNECT_FAILED throws away the
    // only diagnostic that says which key to edit.
    const stub = stubBrowserManager();
    resetRuntimeConfigStore({browser: {keepPage: true}});
    try {
      await withFixture(async (_fixture, client) => {
        const id = await client.request('browser.disconnect', {body: {}});
        const response = await client.responseFor(id);
        const error = response['error'] as {code?: string; message?: string};
        assert.strictEqual(error.code, 'VALIDATION');
        assert.match(error.message ?? '', /keepPage/);
      });
    } finally {
      stub.restore();
      resetRuntimeConfigStore({});
    }
  });

  it('browser.disconnect keeps BROWSER_DISCONNECT_INCOMPLETE instead of flattening it', async () => {
    // A teardown that failed leaves the bridge listening. Its own code is what lets
    // a client tell "retryable, the bridge is still up" from an ordinary failure —
    // `toErrorCode()` reports `error.code` verbatim — so wrapping it into
    // BROWSER_DISCONNECT_FAILED would throw away exactly that distinction.
    const incomplete = Object.assign(
      new Error(
        'browser disconnect incomplete: the bridge could not be stopped and was kept for retry',
      ),
      {code: 'BROWSER_DISCONNECT_INCOMPLETE'},
    );
    const reset = mock.method(BrowserManager, 'resetInstance', async () => {
      throw incomplete;
    });
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        const id = await client.request('browser.disconnect', {body: {}});
        const response = await client.responseFor(id);
        const error = response['error'] as {code?: string; message?: string};
        assert.strictEqual(error.code, 'BROWSER_DISCONNECT_INCOMPLETE');
        assert.match(error.message, /retry/);
      });
    } finally {
      reset.mock.restore();
      resetRuntimeConfigStore({});
    }
  });

  it('env BROWSER_KEEP_PAGE is rescued by `connect --ego` (C1)', async () => {
    // THE regression this round exists to fix. `BROWSER_KEEP_PAGE=true` with no
    // BROWSER_EGO used to make `candidateBrowserConfig()` throw before the
    // request's own `ego: true` could contribute anything: the invariant was
    // asserted on the env-only intermediate that the patch was supposed to
    // complete. The user is told "add ego" and then `connect --ego` is refused —
    // unrecoverable over IPC, because browser.status throws too.
    const stub = stubBrowserManager();
    const savedKeepPage = process.env.BROWSER_KEEP_PAGE;
    const savedEgo = process.env.BROWSER_EGO;
    process.env.BROWSER_KEEP_PAGE = 'true';
    delete process.env.BROWSER_EGO;
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        const id = await client.request('browser.connect', {
          body: {ego: true},
        });
        const response = await client.responseFor(id);
        assert.deepStrictEqual(
          response['error'],
          undefined,
          'the request ego must complete the env-supplied keepPage',
        );
        assert.strictEqual((response['result'] as {mode?: string}).mode, 'ego');
        // The env-supplied retention policy must reach the bridge start options,
        // not merely survive validation.
        const connected = stub.configs.at(-1) as {
          ego?: boolean;
          keepPage?: boolean;
        };
        assert.strictEqual(connected.ego, true);
        assert.strictEqual(connected.keepPage, true);
      });
    } finally {
      stub.restore();
      if (savedKeepPage === undefined) delete process.env.BROWSER_KEEP_PAGE;
      else process.env.BROWSER_KEEP_PAGE = savedKeepPage;
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
      resetRuntimeConfigStore({});
    }
  });

  it('browser.status still works after the env keepPage connect (C1)', async () => {
    // The second half of the regression: the refused connect left the daemon
    // unable to answer anything, because status reads the same merged config.
    const stub = stubBrowserManager();
    const savedKeepPage = process.env.BROWSER_KEEP_PAGE;
    const savedEgo = process.env.BROWSER_EGO;
    process.env.BROWSER_KEEP_PAGE = 'true';
    delete process.env.BROWSER_EGO;
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        const connectId = await client.request('browser.connect', {
          body: {ego: true},
        });
        const connect = await client.responseFor(connectId);
        assert.deepStrictEqual(connect['error'], undefined);

        const statusId = await client.request('browser.status');
        const status = await client.responseFor(statusId);
        assert.deepStrictEqual(
          status['error'],
          undefined,
          'browser.status must survive a config that only became legal via the request',
        );
        assert.strictEqual((status['result'] as {mode?: string}).mode, 'ego');
      });
    } finally {
      stub.restore();
      if (savedKeepPage === undefined) delete process.env.BROWSER_KEEP_PAGE;
      else process.env.BROWSER_KEEP_PAGE = savedKeepPage;
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
      resetRuntimeConfigStore({});
    }
  });

  it('a store-supplied keepPage is rescued by `connect --ego` (C1)', async () => {
    // Same shape with the value coming from the persisted store instead of the
    // environment — e.g. a `browser.keepPage: true` left in config.json.
    const stub = stubBrowserManager();
    resetRuntimeConfigStore({browser: {keepPage: true}});
    try {
      await withFixture(async (_fixture, client) => {
        const id = await client.request('browser.connect', {
          body: {ego: true},
        });
        const response = await client.responseFor(id);
        assert.deepStrictEqual(
          response['error'],
          undefined,
          'the request ego must complete the store-supplied keepPage',
        );
        assert.strictEqual((response['result'] as {mode?: string}).mode, 'ego');
        const connected = stub.configs.at(-1) as {keepPage?: boolean};
        assert.strictEqual(connected.keepPage, true);
      });
    } finally {
      stub.restore();
      resetRuntimeConfigStore({});
    }
  });

  it('keepPage with ego absent from every layer is still rejected (C1)', async () => {
    // The other direction, and the reason the assertion cannot simply be dropped:
    // with no ego anywhere in the merged config the pair is the silent no-op the
    // invariant forbids, whether keepPage came from the env or the store.
    const stub = stubBrowserManager();
    const savedKeepPage = process.env.BROWSER_KEEP_PAGE;
    const savedEgo = process.env.BROWSER_EGO;
    delete process.env.BROWSER_EGO;
    try {
      await withFixture(async (_fixture, client) => {
        const cases: Array<{label: string; seed: Record<string, unknown>}> = [
          {label: 'env only', seed: {}},
          {label: 'store only', seed: {browser: {keepPage: true}}},
        ];
        for (const {label, seed} of cases) {
          if (label === 'env only') process.env.BROWSER_KEEP_PAGE = 'true';
          else delete process.env.BROWSER_KEEP_PAGE;
          resetRuntimeConfigStore(seed);

          const id = await client.request('browser.connect', {body: {}});
          const response = await client.responseFor(id);
          const error = response['error'] as {
            code?: string;
            message?: string;
          };
          assert.equal(error.code, 'VALIDATION', label);
          assert.match(error.message ?? '', /keepPage/, label);
        }
        // ...and a rejected config still leaves a usable daemon behind.
        delete process.env.BROWSER_KEEP_PAGE;
        resetRuntimeConfigStore({});
        const statusId = await client.request('browser.status');
        const status = await client.responseFor(statusId);
        assert.deepStrictEqual(status['error'], undefined);
      });
    } finally {
      stub.restore();
      if (savedKeepPage === undefined) delete process.env.BROWSER_KEEP_PAGE;
      else process.env.BROWSER_KEEP_PAGE = savedKeepPage;
      if (savedEgo === undefined) delete process.env.BROWSER_EGO;
      else process.env.BROWSER_EGO = savedEgo;
      resetRuntimeConfigStore({});
    }
  });

  it('a store commit failure is not reported as a connect failure (loose end 1)', async () => {
    // `commit()` used to run inside the same try as `connectBrowser()`, so any
    // write failure was folded into BROWSER_CONNECT_FAILED and the user went
    // looking at a browser that was never even started. The store write happens
    // before the connect, and its failure has to say so.
    const stub = stubBrowserManager();
    const commit = mock.method(RuntimeConfigStore.prototype, 'commit', () => {
      throw new Error('disk is full');
    });
    resetRuntimeConfigStore({});
    try {
      await withFixture(async (_fixture, client) => {
        const id = await client.request('browser.connect', {
          body: {ego: true},
        });
        const response = await client.responseFor(id);
        const error = response['error'] as {code?: string; message?: string};
        assert.equal(error.code, 'BROWSER_CONFIG_COMMIT_FAILED');
        assert.match(error.message ?? '', /persist/);
        // Nothing was spawned: the connect never ran.
        assert.strictEqual(stub.configs.length, 0);
      });
    } finally {
      commit.mock.restore();
      stub.restore();
      resetRuntimeConfigStore({});
    }
  });
});
