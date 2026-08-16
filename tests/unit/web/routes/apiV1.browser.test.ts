/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {afterEach, describe, it, mock} from 'node:test';

import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../../src/config/RuntimeConfigStore.js';
import {BrowserManager} from '../../../../src/modules/browser/index.js';
import type {ToolMeta} from '../../../../src/tools/tools-meta.js';
import {
  type ApiV1Deps,
  createApiV1Routes,
} from '../../../../src/web/routes/apiV1.js';
import {WsHub} from '../../../../src/web/ws/WsHub.js';
import {JobStore} from '../../../../src/worker/JobStore.js';
import type {ToolAdapter} from '../../../../src/worker/ToolAdapter.js';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  headersSent: boolean;
  setHeader(key: string, value: string): void;
  end(payload: string): void;
}

function request(body?: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function response(): MockResponse {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload;
      this.headersSent = true;
    },
  };
}

function data<T>(res: MockResponse): T {
  return (JSON.parse(res.body) as {data: T}).data;
}

function errorCode(res: MockResponse): string | undefined {
  return (JSON.parse(res.body) as {error?: {code: string}}).error?.code;
}

function errorMessage(res: MockResponse): string | undefined {
  return (JSON.parse(res.body) as {error?: {message: string}}).error?.message;
}

function fakeContextProvider() {
  let browser: {isConnected(): boolean} | null = null;
  let context: {pages(): unknown[]} | null = null;
  return {
    setBrowserManager: () => undefined,
    setBrowser(value: typeof browser) {
      browser = value;
    },
    setContext(value: typeof context) {
      context = value;
    },
    clearContext() {
      context = null;
    },
    init: async () => undefined,
    isBrowserConnected: () => browser?.isConnected() ?? false,
    getContext: () => context,
  };
}

const toolMeta = {name: 'test_tool'} as ToolMeta;

function dependencies(contextProvider = fakeContextProvider()): ApiV1Deps {
  return {
    contextProvider: contextProvider as never,
    toolAdapter: {
      executeTool: async () => ({ok: true}),
    } as unknown as ToolAdapter,
    jobStore: new JobStore(),
    wsHub: new WsHub(),
    getToolMeta: name => (name === toolMeta.name ? toolMeta : undefined),
    listToolsMeta: () => [toolMeta],
    ensureToolsMeta: async () => undefined,
  };
}

function installConnectedBrowser() {
  const context = {pages: () => [{}, {}]};
  const browser = {
    contexts: () => [context],
    isConnected: () => true,
  };
  mock.method(BrowserManager, 'resetInstance', async () => undefined);
  mock.method(BrowserManager, 'getInstance', () => ({
    ensureBrowser: async () => browser,
    getContext: () => context,
  }));
}

async function createSession(
  routes: ReturnType<typeof createApiV1Routes>,
): Promise<string> {
  const res = response();
  await routes.get('POST /api/v1/sessions')!(
    request(),
    res as unknown as ServerResponse,
  );
  return data<{sessionId: string}>(res).sessionId;
}

async function invoke(
  routes: ReturnType<typeof createApiV1Routes>,
  sessionId: string,
): Promise<MockResponse> {
  const res = response();
  await routes.get('POST /api/v1/sessions/:id/invoke')!(
    request({tool: toolMeta.name, params: {}}),
    res as unknown as ServerResponse,
    {id: sessionId},
  );
  return res;
}

afterEach(() => {
  mock.restoreAll();
  resetRuntimeConfigStore({});
});

describe('API v1 browser routes', () => {
  it('reports disconnected state without returning config', async () => {
    const routes = createApiV1Routes(dependencies());
    const res = response();
    await routes.get('GET /api/v1/browser/status')!(
      request(),
      res as unknown as ServerResponse,
    );

    assert.deepEqual(data(res), {
      connected: false,
      mode: 'disconnected',
      pages: 0,
    });
    assert.ok(!res.body.includes('wsHeaders'));
  });

  it('merges a ws target, clears stale targets, and connects', async () => {
    resetRuntimeConfigStore({
      browser: {
        browserURL: 'http://old:9222',
        remoteDebuggingUrl: 'http://legacy:9222',
        headless: true,
      },
    });
    installConnectedBrowser();
    const routes = createApiV1Routes(dependencies());
    const res = response();
    await routes.get('POST /api/v1/browser/connect')!(
      request({wsEndpoint: 'ws://new/devtools', headless: false}),
      res as unknown as ServerResponse,
    );

    assert.deepEqual(data(res), {
      connected: true,
      mode: 'ws-endpoint',
      pages: 2,
    });
    const browser = getRuntimeConfigStore().get().browser;
    assert.strictEqual(browser?.wsEndpoint, 'ws://new/devtools');
    assert.strictEqual(browser?.browserURL, undefined);
    assert.strictEqual(browser?.remoteDebuggingUrl, undefined);
    assert.strictEqual(browser?.headless, false);
  });

  it('clears stale targets for HTTP and local selectors', async () => {
    installConnectedBrowser();
    const cases: Array<
      [
        Record<string, unknown>,
        {browserURL?: string; wsEndpoint?: string; remoteDebuggingUrl?: string},
      ]
    > = [
      [
        {browserURL: 'https://new:9222'},
        {
          browserURL: 'https://new:9222',
          wsEndpoint: undefined,
          remoteDebuggingUrl: undefined,
        },
      ],
      [
        {channel: 'stable'},
        {
          browserURL: undefined,
          wsEndpoint: undefined,
          remoteDebuggingUrl: undefined,
        },
      ],
    ];

    for (const [patch, expected] of cases) {
      resetRuntimeConfigStore({
        browser: {
          browserURL: 'http://old:9222',
          wsEndpoint: 'ws://old/devtools',
          remoteDebuggingUrl: 'http://legacy:9222',
        },
      });
      const routes = createApiV1Routes(dependencies());
      const res = response();
      await routes.get('POST /api/v1/browser/connect')!(
        request(patch),
        res as unknown as ServerResponse,
      );
      const browser = getRuntimeConfigStore().get().browser;
      assert.strictEqual(browser?.browserURL, expected.browserURL);
      assert.strictEqual(browser?.wsEndpoint, expected.wsEndpoint);
      assert.strictEqual(
        browser?.remoteDebuggingUrl,
        expected.remoteDebuggingUrl,
      );
    }
  });

  it('switches between remote and local targets without retaining stale selectors', async () => {
    installConnectedBrowser();
    const cases: Array<
      [
        Record<string, unknown>,
        Record<string, unknown>,
        {
          browserURL?: string;
          wsEndpoint?: string;
          channel?: string;
          executablePath?: string;
        },
      ]
    > = [
      [
        {channel: 'stable'},
        {browserURL: 'http://new:9222'},
        {browserURL: 'http://new:9222'},
      ],
      [{browserURL: 'http://old:9222'}, {channel: 'beta'}, {channel: 'beta'}],
      [
        {executablePath: 'old-browser.exe'},
        {channel: 'stable'},
        {channel: 'stable'},
      ],
      [
        {channel: 'stable'},
        {executablePath: 'new-browser.exe'},
        {executablePath: 'new-browser.exe'},
      ],
    ];

    for (const [initial, patch, expected] of cases) {
      resetRuntimeConfigStore({browser: initial});
      const routes = createApiV1Routes(dependencies());
      const res = response();
      await routes.get('POST /api/v1/browser/connect')!(
        request(patch),
        res as unknown as ServerResponse,
      );

      assert.strictEqual(res.statusCode, 200);
      const browser = getRuntimeConfigStore().get().browser;
      assert.strictEqual(browser?.browserURL, expected.browserURL);
      assert.strictEqual(browser?.wsEndpoint, expected.wsEndpoint);
      assert.strictEqual(browser?.channel, expected.channel);
      assert.strictEqual(browser?.executablePath, expected.executablePath);
      assert.strictEqual(browser?.remoteDebuggingUrl, undefined);
    }
  });

  it('uses current config for an empty body and overrides env-seeded targets', async () => {
    const previous = process.env.BROWSER_URL;
    process.env.BROWSER_URL = 'http://env:9222';
    try {
      resetRuntimeConfigStore();
      installConnectedBrowser();
      const routes = createApiV1Routes(dependencies());
      const first = response();
      await routes.get('POST /api/v1/browser/connect')!(
        request({wsEndpoint: 'ws://runtime/devtools'}),
        first as unknown as ServerResponse,
      );
      assert.strictEqual(data<{mode: string}>(first).mode, 'ws-endpoint');

      const second = response();
      await routes.get('POST /api/v1/browser/connect')!(
        request({}),
        second as unknown as ServerResponse,
      );
      assert.strictEqual(data<{mode: string}>(second).mode, 'ws-endpoint');
    } finally {
      if (previous === undefined) delete process.env.BROWSER_URL;
      else process.env.BROWSER_URL = previous;
      resetRuntimeConfigStore({});
    }
  });

  it('rejects conflicts, invalid values, and unknown fields', async () => {
    const cases: Array<[unknown, string]> = [
      [null, 'VALIDATION'],
      [[], 'VALIDATION'],
      [
        {browserURL: 'http://host:9222', wsEndpoint: 'ws://host/devtools'},
        'BROWSER_CONFIG_CONFLICT',
      ],
      [{browserURL: 'ftp://host'}, 'VALIDATION'],
      [{wsEndpoint: 'http://host'}, 'VALIDATION'],
      [{viewport: {width: 0, height: 720}}, 'VALIDATION'],
      [{wsHeaders: {Authorization: 123}}, 'VALIDATION'],
      [{unknownField: true}, 'VALIDATION'],
    ];

    for (const [body, expectedCode] of cases) {
      const routes = createApiV1Routes(dependencies());
      const res = response();
      await routes.get('POST /api/v1/browser/connect')!(
        request(body),
        res as unknown as ServerResponse,
      );
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(errorCode(res), expectedCode);
    }
  });

  it('disconnects idempotently', async () => {
    mock.method(BrowserManager, 'resetInstance', async () => undefined);
    const routes = createApiV1Routes(dependencies());
    const res = response();
    await routes.get('POST /api/v1/browser/disconnect')!(
      request(),
      res as unknown as ServerResponse,
    );

    assert.deepEqual(data(res), {
      connected: false,
      mode: 'disconnected',
      pages: 0,
    });
  });

  it('requires a literal boolean to force disconnect', async () => {
    const reset = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const routes = createApiV1Routes(dependencies());

    for (const body of [{force: 'true'}, {force: 1}, {force: true, extra: 1}]) {
      const res = response();
      await routes.get('POST /api/v1/browser/disconnect')!(
        request(body),
        res as unknown as ServerResponse,
      );
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(errorCode(res), 'VALIDATION');
    }
    assert.strictEqual(reset.mock.callCount(), 0);
  });

  it('does not expose disconnect failure details', async () => {
    mock.method(BrowserManager, 'resetInstance', async () => {
      throw new Error('disconnect failed with Bearer secret');
    });
    const routes = createApiV1Routes(dependencies());
    const res = response();
    await routes.get('POST /api/v1/browser/disconnect')!(
      request(),
      res as unknown as ServerResponse,
    );

    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(errorCode(res), 'BROWSER_DISCONNECT_FAILED');
    assert.strictEqual(errorMessage(res), 'failed to disconnect browser');
    assert.ok(!res.body.includes('Bearer secret'));
  });

  it('rejects connect before mutating config while a tool job is active', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const deps = dependencies();
    deps.toolAdapter = {
      executeTool: async () => gate,
    } as unknown as ToolAdapter;
    installConnectedBrowser();
    const routes = createApiV1Routes(deps);
    const sessionId = await createSession(routes);
    await invoke(routes, sessionId);
    const res = response();

    try {
      await routes.get('POST /api/v1/browser/connect')!(
        request({browserURL: 'http://new:9222'}),
        res as unknown as ServerResponse,
      );
      assert.strictEqual(res.statusCode, 409);
      assert.strictEqual(errorCode(res), 'WORKER_BUSY');
      assert.strictEqual(
        getRuntimeConfigStore().get().browser?.browserURL,
        undefined,
      );

      const disconnectResponse = response();
      await routes.get('POST /api/v1/browser/disconnect')!(
        request(),
        disconnectResponse as unknown as ServerResponse,
      );
      assert.strictEqual(disconnectResponse.statusCode, 409);
      assert.strictEqual(errorCode(disconnectResponse), 'WORKER_BUSY');
    } finally {
      release();
      await new Promise(resolve => setImmediate(resolve));
    }
  });

  it('force-disconnect cancels an active job and resets the browser', async () => {
    const deps = dependencies();
    deps.toolAdapter = {
      executeTool: async () => await new Promise<never>(() => undefined),
    } as unknown as ToolAdapter;
    const reset = mock.method(
      BrowserManager,
      'resetInstance',
      async () => undefined,
    );
    const routes = createApiV1Routes(deps);
    const sessionId = await createSession(routes);
    const invokeResponse = await invoke(routes, sessionId);
    const jobId = data<{jobId: string}>(invokeResponse).jobId;
    const disconnectResponse = response();

    await routes.get('POST /api/v1/browser/disconnect')!(
      request({force: true}),
      disconnectResponse as unknown as ServerResponse,
    );

    assert.strictEqual(disconnectResponse.statusCode, 200);
    assert.deepEqual(data(disconnectResponse), {
      connected: false,
      mode: 'disconnected',
      pages: 0,
    });
    assert.strictEqual(deps.jobStore.get(jobId).status, 'cancelled');
    assert.strictEqual(deps.jobStore.get(jobId).error?.code, 'JOB_CANCELLED');
    assert.strictEqual(reset.mock.callCount(), 1);
  });

  it('rejects a new tool job while connect is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const context = fakeContextProvider();
    const browser = {contexts: () => [], isConnected: () => true};
    mock.method(BrowserManager, 'resetInstance', async () => undefined);
    mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        await gate;
        return browser;
      },
      getContext: () => null,
    }));
    const routes = createApiV1Routes(dependencies(context));
    const sessionId = await createSession(routes);
    const connectResponse = response();
    const connecting = routes.get('POST /api/v1/browser/connect')!(
      request({channel: 'stable'}),
      connectResponse as unknown as ServerResponse,
    );
    await new Promise(resolve => setImmediate(resolve));

    const invokeResponse = await invoke(routes, sessionId);
    assert.strictEqual(invokeResponse.statusCode, 409);
    assert.strictEqual(errorCode(invokeResponse), 'WORKER_BUSY');

    const disconnectResponse = response();
    await routes.get('POST /api/v1/browser/disconnect')!(
      request(),
      disconnectResponse as unknown as ServerResponse,
    );
    assert.strictEqual(disconnectResponse.statusCode, 409);
    assert.strictEqual(errorCode(disconnectResponse), 'WORKER_BUSY');

    release();
    await connecting;
  });

  it('releases the browser operation guard after connect fails', async () => {
    const context = fakeContextProvider();
    mock.method(BrowserManager, 'resetInstance', async () => undefined);
    const failing = mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => {
        throw new Error(
          'connect failed for Bearer secret at ws://host/devtools',
        );
      },
      getContext: () => null,
    }));
    const routes = createApiV1Routes(dependencies(context));
    const first = response();
    await routes.get('POST /api/v1/browser/connect')!(
      request({
        wsEndpoint: 'ws://host/devtools',
        wsHeaders: {Authorization: 'Bearer secret'},
      }),
      first as unknown as ServerResponse,
    );
    assert.strictEqual(first.statusCode, 502);
    assert.strictEqual(errorCode(first), 'BROWSER_CONNECT_FAILED');
    assert.strictEqual(errorMessage(first), 'failed to connect browser');
    assert.strictEqual(
      getRuntimeConfigStore().get().browser?.wsEndpoint,
      'ws://host/devtools',
    );
    assert.ok(!first.body.includes('Bearer secret'));
    assert.ok(!first.body.includes('ws://host/devtools'));

    failing.mock.restore();
    const browser = {contexts: () => [], isConnected: () => true};
    mock.method(BrowserManager, 'getInstance', () => ({
      ensureBrowser: async () => browser,
      getContext: () => null,
    }));
    const second = response();
    await routes.get('POST /api/v1/browser/connect')!(
      request({}),
      second as unknown as ServerResponse,
    );

    assert.strictEqual(second.statusCode, 200);
    assert.notStrictEqual(errorCode(second), 'WORKER_BUSY');
  });
});
