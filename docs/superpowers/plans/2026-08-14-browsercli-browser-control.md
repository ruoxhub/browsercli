# BrowserCLI Browser Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `browsercli browser connect|disconnect|status` commands backed by authenticated `/api/v1/browser/*` Worker routes, with incremental runtime configuration and safe lifecycle serialization.

**Architecture:** Keep `browsercli` a pure remote client. The Worker owns validation, runtime configuration, browser lifecycle, and status; the CLI maps friendly kebab-case flags to the stable HTTP contract. Reuse `BrowserConnectionManager`, `RuntimeConfigStore`, `BrowserConfigSchema`, `ToolContextProvider`, and `WorkerHttpClient`; add no dependency and do not alter the legacy Web-console routes.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, built-in `fetch`, Zod 3, `axi-sdk-js`, existing REST router and BrowserManager/Patchright runtime.

**Design:** `docs/superpowers/specs/2026-08-14-browsercli-browser-control-design.md` (`0d3b593`)

## Global Constraints

- Node.js must remain `^20.19.0 || ^22.12.0 || >=23`.
- Do not add dependencies, edit generated `build/`, restore local Worker process commands, or change `/api/browser/*`.
- Preserve the default zero-JS-injection and minimal-stealth behavior; `cloak`, `jsStealth`, and `fullStealthArgs` remain explicit opt-ins.
- Browser state is Worker-global. Tool jobs and browser connect/disconnect operations must be mutually exclusive; status remains readable.
- `/api/v1/browser/*` stays behind the existing Bearer Token boundary and never returns configuration or `wsHeaders`.
- The request accepts only the approved common fields; Worker validation is authoritative even when the CLI validates first.
- Do not start a real browser in tests. Mock `BrowserManager` and use loopback HTTP test servers.
- The working tree already contains user changes in `src/web/routes/apiV1.ts`, `browsercli/src/WorkerHttpClient.ts`, and `browsercli/tests/unit/WorkerHttpClient.test.ts`, plus an untracked `tests/unit/web/routes/apiV1.test.ts`. Preserve them. Use the new browser-specific test files below and `git add -p` for overlapping source files.
- Before every commit, inspect `git diff --cached --name-status` and `git diff --cached`; never stage an unrelated hunk.

## File Map

| File                                                     | Responsibility                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/worker/BrowserConnectionManager.ts`                 | Shared connection mode and status calculation; existing connect/disconnect coordination    |
| `tests/unit/worker/BrowserConnectionManager.test.ts`     | Pure mode/status behavior and existing lifecycle mocks                                     |
| `src/web/routes/apiV1.ts`                                | Browser request validation, config merge, three v1 routes, and lifecycle/job serialization |
| `src/web/ConsoleServer.ts`                               | Inject the current `ToolContextProvider` into v1 route dependencies                        |
| `tests/unit/web/routes/apiV1.browser.test.ts`            | Isolated v1 browser route/config/concurrency tests                                         |
| `browsercli/src/WorkerHttpClient.ts`                     | Typed client methods for browser status/connect/disconnect                                 |
| `browsercli/tests/unit/WorkerHttpClient.browser.test.ts` | HTTP path/body/auth tests without touching the existing dirty client test                  |
| `browsercli/src/commands/browser.ts`                     | Subcommand dispatch, approved flag parsing, validation, and output                         |
| `browsercli/tests/unit/browser.test.ts`                  | CLI mapping, conflicts, dispatch, and output tests                                         |
| `browsercli/src/app.ts`                                  | Register the new top-level command                                                         |
| `browsercli/src/help.ts`                                 | Top-level and command-group help                                                           |
| `browsercli/tests/unit/help.test.ts`                     | Help and kept-command coverage                                                             |

---

### Task 1: Centralize Browser Mode and Status

**Files:**

- Modify: `src/worker/BrowserConnectionManager.ts:14-63`
- Modify: `tests/unit/worker/BrowserConnectionManager.test.ts:10-80`

**Interfaces:**

- Consumes: `BrowserManagerConfig`, `ToolContextProvider.isBrowserConnected()`, and `ToolContextProvider.getContext()`.
- Produces:
  - `type BrowserConnectionMode = 'attach' | 'ws-endpoint' | 'launch' | 'disconnected'`
  - `interface BrowserConnectionStatus {connected: boolean; mode: BrowserConnectionMode; pages: number}`
  - `getBrowserConnectionMode(config: BrowserManagerConfig): Exclude<BrowserConnectionMode, 'disconnected'>`
  - `getBrowserConnectionStatus(contextProvider: ToolContextProvider, config: BrowserManagerConfig): BrowserConnectionStatus`

- [ ] **Step 1: Write failing mode and status tests**

Extend the import and add these tests inside the existing `describe`:

```ts
import {
  connectBrowser,
  disconnectBrowser,
  getBrowserConnectionMode,
  getBrowserConnectionStatus,
} from '../../../src/worker/BrowserConnectionManager.js';

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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run build:compile
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/BrowserConnectionManager.test.js
```

Expected: FAIL because `getBrowserConnectionMode` and `getBrowserConnectionStatus` are not exported.

- [ ] **Step 3: Add the shared status implementation**

Add above `connectBrowser` and replace the inline mode ternary in `connectBrowser`:

```ts
export type BrowserConnectionMode =
  | 'attach'
  | 'ws-endpoint'
  | 'launch'
  | 'disconnected';

export interface BrowserConnectionStatus {
  connected: boolean;
  mode: BrowserConnectionMode;
  pages: number;
}

export function getBrowserConnectionMode(
  config: BrowserManagerConfig,
): Exclude<BrowserConnectionMode, 'disconnected'> {
  if (
    config.wsEndpoint ||
    config.remoteDebuggingUrl?.startsWith('ws://') ||
    config.remoteDebuggingUrl?.startsWith('wss://')
  ) {
    return 'ws-endpoint';
  }
  if (config.browserURL || config.remoteDebuggingUrl) return 'attach';
  return 'launch';
}

export function getBrowserConnectionStatus(
  contextProvider: ToolContextProvider,
  config: BrowserManagerConfig,
): BrowserConnectionStatus {
  try {
    if (!contextProvider.isBrowserConnected()) {
      return {connected: false, mode: 'disconnected', pages: 0};
    }
    return {
      connected: true,
      mode: getBrowserConnectionMode(config),
      pages: contextProvider.getContext()?.pages().length ?? 0,
    };
  } catch {
    return {connected: false, mode: 'disconnected', pages: 0};
  }
}
```

Replace lines 45-49 with:

```ts
const mode = getBrowserConnectionMode(config);
```

Narrow `ConnectResult.mode` to `Exclude<BrowserConnectionMode, 'disconnected'>`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same two commands from Step 2.

Expected: all `BrowserConnectionManager` tests pass.

- [ ] **Step 5: Commit only Task 1**

Run the dependency checks once before the feature commit sequence; no task changes a manifest or lockfile:

```powershell
npm audit
npm --prefix browsercli audit
```

Record any pre-existing advisory without changing dependencies. Then stage and commit:

```powershell
git add -- src/worker/BrowserConnectionManager.ts tests/unit/worker/BrowserConnectionManager.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(worker): expose browser connection status"
```

---

### Task 2: Add Validated `/api/v1/browser/*` Routes

**Files:**

- Modify: `src/web/routes/apiV1.ts:6-222`
- Modify: `src/web/ConsoleServer.ts:166-173`
- Create: `tests/unit/web/routes/apiV1.browser.test.ts`

**Interfaces:**

- Consumes: Task 1 status helpers, `BrowserConfigSchema`, `RuntimeConfigStore`, `getBrowserManagerConfig()`, `connectBrowser()`, `disconnectBrowser()`, and the existing response envelope.
- Produces:
  - `ApiV1Deps.contextProvider: ToolContextProvider`
  - `GET /api/v1/browser/status`
  - `POST /api/v1/browser/connect`
  - `POST /api/v1/browser/disconnect`

- [ ] **Step 1: Create failing browser route tests**

Create `tests/unit/web/routes/apiV1.browser.test.ts` with local request/response helpers and a stateful fake context provider. The essential setup is:

```ts
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

afterEach(() => {
  mock.restoreAll();
  resetRuntimeConfigStore({});
});
```

Add these first behavior tests:

```ts
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
});
```

- [ ] **Step 2: Run the route test and verify RED**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/web/routes/apiV1.browser.test.js
```

Expected: FAIL because `ApiV1Deps.contextProvider` and the browser routes do not exist.

- [ ] **Step 3: Add strict request parsing and target normalization**

In `apiV1.ts`, add these imports in the existing import groups:

```ts
import {getRuntimeConfigStore} from '../../config/RuntimeConfigStore.js';
import {type BrowserConfig, BrowserConfigSchema} from '../../config/schema.js';
import {getBrowserManagerConfig} from '../../config/servicesConfig.js';
import type {BrowserManagerConfig} from '../../modules/browser/index.js';
import {
  connectBrowser,
  disconnectBrowser,
  getBrowserConnectionStatus,
} from '../../worker/BrowserConnectionManager.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
```

Add this required field to `ApiV1Deps`:

```ts
contextProvider: ToolContextProvider;
```

Define the approved schema and helpers above `createApiV1Routes`:

```ts
const BrowserConnectSchema = BrowserConfigSchema.pick({
  acceptInsecureCerts: true,
  browserURL: true,
  channel: true,
  cloak: true,
  executablePath: true,
  fullStealthArgs: true,
  headless: true,
  isolated: true,
  jsStealth: true,
  minimalStealth: true,
  userDataDir: true,
  viewport: true,
  wsEndpoint: true,
  wsHeaders: true,
}).strict();

class BrowserConfigRequestError extends Error {
  constructor(
    readonly code: 'VALIDATION' | 'BROWSER_CONFIG_CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireProtocol(
  key: string,
  value: string | undefined,
  protocols: string[],
): void {
  if (value === undefined) return;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new BrowserConfigRequestError('VALIDATION', `${key} is not a URL`);
  }
  if (!protocols.includes(protocol)) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      `${key} must use ${protocols.join(' or ')}`,
    );
  }
}

function parseBrowserConnectBody(body: Record<string, unknown>): BrowserConfig {
  const remote = hasOwn(body, 'browserURL') || hasOwn(body, 'wsEndpoint');
  const local = hasOwn(body, 'channel') || hasOwn(body, 'executablePath');
  if (
    (hasOwn(body, 'browserURL') && hasOwn(body, 'wsEndpoint')) ||
    (hasOwn(body, 'channel') && hasOwn(body, 'executablePath')) ||
    (remote && local)
  ) {
    throw new BrowserConfigRequestError(
      'BROWSER_CONFIG_CONFLICT',
      'browserURL, wsEndpoint, channel, and executablePath select mutually exclusive targets',
    );
  }

  const parsed = BrowserConnectSchema.safeParse(body);
  if (!parsed.success) {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      parsed.error.issues
        .map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  }
  requireProtocol('browserURL', parsed.data.browserURL, ['http:', 'https:']);
  requireProtocol('wsEndpoint', parsed.data.wsEndpoint, ['ws:', 'wss:']);
  if (parsed.data.executablePath === '') {
    throw new BrowserConfigRequestError(
      'VALIDATION',
      'executablePath must not be empty',
    );
  }

  const patch: BrowserConfig = {...parsed.data};
  if (hasOwn(parsed.data, 'browserURL')) {
    patch.wsEndpoint = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (hasOwn(parsed.data, 'wsEndpoint')) {
    patch.browserURL = undefined;
    patch.remoteDebuggingUrl = undefined;
  } else if (
    hasOwn(parsed.data, 'channel') ||
    hasOwn(parsed.data, 'executablePath')
  ) {
    patch.browserURL = undefined;
    patch.wsEndpoint = undefined;
    patch.remoteDebuggingUrl = undefined;
  }
  return patch;
}

function effectiveBrowserConfig(): BrowserManagerConfig {
  return {
    ...getBrowserManagerConfig(),
    ...(getRuntimeConfigStore().get().browser ?? {}),
  };
}
```

- [ ] **Step 4: Add the three route handlers**

Add before the jobs route:

```ts
routes.set('GET /api/v1/browser/status', async (_req, res) => {
  sendJson(
    res,
    getBrowserConnectionStatus(deps.contextProvider, effectiveBrowserConfig()),
  );
});

routes.set('POST /api/v1/browser/connect', async (req, res) => {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_JSON';
    sendError(
      res,
      code,
      code === 'PAYLOAD_TOO_LARGE'
        ? 'request body exceeds the size limit'
        : 'request body is not valid JSON',
      code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
    );
    return;
  }

  let patch: BrowserConfig;
  try {
    patch = parseBrowserConnectBody(body);
  } catch (error) {
    if (error instanceof BrowserConfigRequestError) {
      sendError(res, error.code, error.message, 400);
      return;
    }
    throw error;
  }

  try {
    getRuntimeConfigStore().update({browser: patch});
    const config = effectiveBrowserConfig();
    await connectBrowser(deps.contextProvider, config);
    const status = getBrowserConnectionStatus(deps.contextProvider, config);
    deps.wsHub.broadcast('worker.status', {browser: status});
    sendJson(res, status);
  } catch (error) {
    sendError(
      res,
      'BROWSER_CONNECT_FAILED',
      error instanceof Error ? error.message : String(error),
      502,
    );
  }
});

routes.set('POST /api/v1/browser/disconnect', async (_req, res) => {
  try {
    await disconnectBrowser(deps.contextProvider);
    const status = {
      connected: false,
      mode: 'disconnected',
      pages: 0,
    } as const;
    deps.wsHub.broadcast('worker.status', {browser: status});
    sendJson(res, status);
  } catch (error) {
    sendError(
      res,
      'BROWSER_DISCONNECT_FAILED',
      error instanceof Error ? error.message : String(error),
      502,
    );
  }
});
```

In `ConsoleServer.setupRoutes()`, pass:

```ts
contextProvider: this.options.runtime.contextProvider!,
```

- [ ] **Step 5: Run focused route and manager tests**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/web/routes/apiV1.browser.test.js build/tests/unit/worker/BrowserConnectionManager.test.js
```

Expected: both files pass.

- [ ] **Step 6: Commit only Task 2 hunks**

Because `apiV1.ts` already has user changes, stage its new hunks interactively:

```powershell
git add -p -- src/web/routes/apiV1.ts
git add -- src/web/ConsoleServer.ts tests/unit/web/routes/apiV1.browser.test.ts
git diff --cached --check
git diff --cached --name-status
git diff --cached
git commit -m "feat(api): add browser control routes"
```

The cached diff must not include the pre-existing session/job-store changes from `apiV1.ts`.

---

### Task 3: Serialize Browser Lifecycle Operations with Tool Jobs

**Files:**

- Modify: `src/web/routes/apiV1.ts:81-211`
- Modify: `tests/unit/web/routes/apiV1.browser.test.ts`

**Interfaces:**

- Consumes: the existing route-local `activeJobId` and Task 2 handlers.
- Produces: route-local `browserOperation: 'connect' | 'disconnect' | undefined`; two-way `409 WORKER_BUSY` exclusion.

- [ ] **Step 1: Add failing two-way exclusion tests**

Add these local helpers:

```ts
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
```

Then add:

```ts
it('rejects connect before mutating config while a tool job is active', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const deps = dependencies();
  deps.toolAdapter = {
    executeTool: async () => gate,
  } as unknown as ToolAdapter;
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
      throw new Error('connect failed');
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
  assert.strictEqual(
    getRuntimeConfigStore().get().browser?.wsEndpoint,
    'ws://host/devtools',
  );
  assert.ok(!first.body.includes('Bearer secret'));

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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run build:compile
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/web/routes/apiV1.browser.test.js
```

Expected: the first test reaches BrowserManager instead of returning `409`, or the second invocation returns `202` instead of `409`.

- [ ] **Step 3: Add a single route-local browser operation guard**

Beside `activeJobId`, add:

```ts
let browserOperation: 'connect' | 'disconnect' | undefined;
```

Add this helper inside `createApiV1Routes`:

```ts
function rejectIfBusy(res: ServerResponse): boolean {
  if (!activeJobId && !browserOperation) return false;
  sendError(
    res,
    'WORKER_BUSY',
    activeJobId
      ? `worker is busy with job ${activeJobId}`
      : `worker is busy with browser ${browserOperation}`,
    409,
    activeJobId ? {jobId: activeJobId} : {operation: browserOperation},
  );
  return true;
}
```

Replace the current invocation `activeJobId` guard with `if (rejectIfBusy(res)) return;`.

After connect body validation but before `RuntimeConfigStore.update()`, add:

```ts
if (rejectIfBusy(res)) return;
browserOperation = 'connect';
try {
  getRuntimeConfigStore().update({browser: patch});
  const config = effectiveBrowserConfig();
  await connectBrowser(deps.contextProvider, config);
  const status = getBrowserConnectionStatus(deps.contextProvider, config);
  deps.wsHub.broadcast('worker.status', {browser: status});
  sendJson(res, status);
} catch (error) {
  sendError(
    res,
    'BROWSER_CONNECT_FAILED',
    error instanceof Error ? error.message : String(error),
    502,
  );
} finally {
  browserOperation = undefined;
}
```

Replace the Task 2 disconnect handler with:

```ts
routes.set('POST /api/v1/browser/disconnect', async (_req, res) => {
  if (rejectIfBusy(res)) return;
  browserOperation = 'disconnect';
  try {
    await disconnectBrowser(deps.contextProvider);
    const status = {
      connected: false,
      mode: 'disconnected',
      pages: 0,
    } as const;
    deps.wsHub.broadcast('worker.status', {browser: status});
    sendJson(res, status);
  } catch (error) {
    sendError(
      res,
      'BROWSER_DISCONNECT_FAILED',
      error instanceof Error ? error.message : String(error),
      502,
    );
  } finally {
    browserOperation = undefined;
  }
});
```

The connect and disconnect guards must be set synchronously before the first lifecycle `await`.

- [ ] **Step 4: Run the focused route tests and verify GREEN**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/web/routes/apiV1.browser.test.js
```

Expected: all browser route tests pass, including the guard-release regression.

- [ ] **Step 5: Commit only Task 3 hunks**

```powershell
git add -p -- src/web/routes/apiV1.ts
git add -- tests/unit/web/routes/apiV1.browser.test.ts
git diff --cached --check
git diff --cached --name-status
git diff --cached
git commit -m "fix(api): serialize browser lifecycle operations"
```

---

### Task 4: Add Typed Browser Methods to `WorkerHttpClient`

**Files:**

- Modify: `browsercli/src/WorkerHttpClient.ts:18-114`
- Create: `browsercli/tests/unit/WorkerHttpClient.browser.test.ts`

**Interfaces:**

- Consumes: the three Task 2 HTTP endpoints and the existing private `json<T>()` envelope decoder.
- Produces:
  - `interface BrowserConnectionStatus {connected: boolean; mode: 'attach' | 'ws-endpoint' | 'launch' | 'disconnected'; pages: number}`
  - `interface BrowserConnectOptions` containing only the approved request fields
  - `getBrowserStatus()`, `connectBrowser(options)`, and `disconnectBrowser()`

- [ ] **Step 1: Create a failing HTTP contract test**

Create `browsercli/tests/unit/WorkerHttpClient.browser.test.ts`:

```ts
import assert from 'node:assert/strict';
import {createServer, type IncomingMessage} from 'node:http';
import {describe, it} from 'node:test';

import {WorkerHttpClient} from '../../src/WorkerHttpClient.js';

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

describe('WorkerHttpClient browser control', () => {
  it('uses the v1 paths, body, and bearer token', async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      body?: unknown;
    }> = [];
    const server = createServer(async (req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: await readBody(req),
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          data:
            req.url === '/api/v1/browser/disconnect'
              ? {connected: false, mode: 'disconnected', pages: 0}
              : {connected: true, mode: 'attach', pages: 2},
        }),
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as {port: number}).port}`;

    try {
      const client = new WorkerHttpClient({baseUrl, apiToken: 'secret'});
      await client.getBrowserStatus();
      await client.connectBrowser({
        browserURL: 'http://127.0.0.1:9222',
        headless: false,
      });
      await client.disconnectBrowser();

      assert.deepEqual(requests, [
        {
          method: 'GET',
          url: '/api/v1/browser/status',
          authorization: 'Bearer secret',
          body: undefined,
        },
        {
          method: 'POST',
          url: '/api/v1/browser/connect',
          authorization: 'Bearer secret',
          body: {
            browserURL: 'http://127.0.0.1:9222',
            headless: false,
          },
        },
        {
          method: 'POST',
          url: '/api/v1/browser/disconnect',
          authorization: 'Bearer secret',
          body: undefined,
        },
      ]);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
```

- [ ] **Step 2: Run browsercli tests and verify RED**

```powershell
npm --prefix browsercli test
```

Expected: TypeScript fails because the three client methods do not exist.

- [ ] **Step 3: Add the exact client types and methods**

Add beside `JobStatus`:

```ts
export type BrowserConnectionMode =
  | 'attach'
  | 'ws-endpoint'
  | 'launch'
  | 'disconnected';

export interface BrowserConnectionStatus {
  connected: boolean;
  mode: BrowserConnectionMode;
  pages: number;
}

export interface BrowserConnectOptions {
  acceptInsecureCerts?: boolean;
  browserURL?: string;
  channel?: string;
  cloak?: boolean;
  executablePath?: string;
  fullStealthArgs?: boolean;
  headless?: boolean;
  isolated?: boolean;
  jsStealth?: boolean;
  minimalStealth?: boolean;
  userDataDir?: string;
  viewport?: {width: number; height: number};
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
}
```

Add after `health()`:

```ts
async getBrowserStatus(): Promise<BrowserConnectionStatus> {
  return this.json('/browser/status');
}

async connectBrowser(
  options: BrowserConnectOptions = {},
): Promise<BrowserConnectionStatus> {
  return this.json('/browser/connect', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(options),
  });
}

async disconnectBrowser(): Promise<BrowserConnectionStatus> {
  return this.json('/browser/disconnect', {method: 'POST'});
}
```

- [ ] **Step 4: Run browsercli tests and typecheck**

```powershell
npm --prefix browsercli test
npm --prefix browsercli run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit only Task 4 hunks**

`WorkerHttpClient.ts` already contains user changes, so do not stage the whole file:

```powershell
git add -p -- browsercli/src/WorkerHttpClient.ts
git add -- browsercli/tests/unit/WorkerHttpClient.browser.test.ts
git diff --cached --check
git diff --cached --name-status
git diff --cached
git commit -m "feat(browsercli): add browser HTTP client methods"
```

The cached diff must not include the existing stream subscription or timeout changes.

---

### Task 5: Implement `browsercli browser` Parsing and Dispatch

**Files:**

- Create: `browsercli/src/commands/browser.ts`
- Create: `browsercli/tests/unit/browser.test.ts`

**Interfaces:**

- Consumes: Task 4 `BrowserConnectOptions`, `BrowserConnectionStatus`, and three client methods; existing `parseArgs`, `AxiError`, `successOutput`, and `tableOutput`.
- Produces: `browserCommand: AxiCliCommand<WorkerContext>`.

- [ ] **Step 1: Write failing command tests**

Create `browsercli/tests/unit/browser.test.ts` with a recording fake client:

```ts
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {browserCommand} from '../../src/commands/browser.js';
import type {AxiStructuredOutput} from '../../src/output.js';
import type {WorkerContext} from '../../src/types.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
  WorkerHttpClient,
} from '../../src/WorkerHttpClient.js';

function context() {
  const calls: Array<{action: string; options?: BrowserConnectOptions}> = [];
  const connected: BrowserConnectionStatus = {
    connected: true,
    mode: 'ws-endpoint',
    pages: 2,
  };
  const disconnected: BrowserConnectionStatus = {
    connected: false,
    mode: 'disconnected',
    pages: 0,
  };
  const client = {
    connectBrowser: async (options: BrowserConnectOptions) => {
      calls.push({action: 'connect', options});
      return connected;
    },
    disconnectBrowser: async () => {
      calls.push({action: 'disconnect'});
      return disconnected;
    },
    getBrowserStatus: async () => {
      calls.push({action: 'status'});
      return connected;
    },
  } as unknown as WorkerHttpClient;
  return {
    calls,
    ctx: {httpClient: client, transport: 'http'} as WorkerContext,
  };
}

describe('browserCommand', () => {
  it('maps approved connect flags to the HTTP payload', async () => {
    const {calls, ctx} = context();
    const output = (await browserCommand(
      [
        'connect',
        '--ws-endpoint',
        'wss://host/devtools',
        '--ws-headers',
        '{"Authorization":"Bearer token"}',
        '--headless=false',
        '--isolated',
        '--user-data-dir',
        'profile-dir',
        '--viewport',
        '1280x720',
        '--accept-insecure-certs',
        '--cloak=false',
        '--js-stealth',
        '--minimal-stealth',
        '--full-stealth-args=false',
      ],
      ctx,
    )) as AxiStructuredOutput;

    assert.deepEqual(calls, [
      {
        action: 'connect',
        options: {
          wsEndpoint: 'wss://host/devtools',
          wsHeaders: {Authorization: 'Bearer token'},
          headless: false,
          isolated: true,
          userDataDir: 'profile-dir',
          viewport: {width: 1280, height: 720},
          acceptInsecureCerts: true,
          cloak: false,
          jsStealth: true,
          minimalStealth: true,
          fullStealthArgs: false,
        },
      },
    ]);
    assert.strictEqual(output.command, 'browser');
    assert.strictEqual(output.action, 'connect');
    assert.strictEqual(output.connected, true);
    assert.ok(!JSON.stringify(output).includes('Bearer token'));
  });

  it('maps local targets and sends an empty patch when no flags are given', async () => {
    const executable = context();
    await browserCommand(
      ['connect', '--executable-path', 'C:\\Chrome\\chrome.exe'],
      executable.ctx,
    );
    assert.deepEqual(executable.calls, [
      {
        action: 'connect',
        options: {executablePath: 'C:\\Chrome\\chrome.exe'},
      },
    ]);

    const channel = context();
    await browserCommand(['connect', '--channel', 'stable'], channel.ctx);
    assert.deepEqual(channel.calls, [
      {action: 'connect', options: {channel: 'stable'}},
    ]);

    const current = context();
    await browserCommand(['connect'], current.ctx);
    assert.deepEqual(current.calls, [{action: 'connect', options: {}}]);
  });

  it('dispatches status and disconnect', async () => {
    const first = context();
    await browserCommand(['status', '--json'], first.ctx);
    assert.deepEqual(first.calls, [{action: 'status'}]);

    const second = context();
    await browserCommand(['disconnect'], second.ctx);
    assert.deepEqual(second.calls, [{action: 'disconnect'}]);
  });

  it('rejects conflicting targets and invalid values before HTTP', async () => {
    const invalid: string[][] = [
      ['connect', '--browser-url', 'http://host', '--ws-endpoint', 'ws://host'],
      ['connect', '--browser-url', 'ftp://host'],
      ['connect', '--ws-endpoint', 'http://host'],
      ['connect', '--channel', 'stable', '--executable-path', 'chrome.exe'],
      ['connect', '--viewport', '1280'],
      ['connect', '--ws-headers', '{"Authorization":1}'],
      ['connect', '--headless=maybe'],
      ['connect', '--unknown'],
      ['status', '--headless'],
      ['unknown'],
    ];

    for (const args of invalid) {
      const {calls, ctx} = context();
      await assert.rejects(() => browserCommand(args, ctx));
      assert.deepEqual(calls, []);
    }
  });

  it('uses table output by default and structured output for --json', async () => {
    const table = context();
    const tableOutput = (await browserCommand(
      ['status'],
      table.ctx,
    )) as AxiStructuredOutput;
    assert.deepEqual(tableOutput.headers, ['Property', 'Value']);
    assert.ok(Array.isArray(tableOutput.rows));

    const json = context();
    const jsonOutput = (await browserCommand(
      ['status', '--json'],
      json.ctx,
    )) as AxiStructuredOutput;
    assert.strictEqual(jsonOutput.status, 'success');
    assert.strictEqual(jsonOutput.mode, 'ws-endpoint');
    assert.strictEqual(jsonOutput.pages, 2);
  });
});
```

- [ ] **Step 2: Run browsercli tests and verify RED**

```powershell
npm --prefix browsercli test
```

Expected: FAIL because `commands/browser.ts` does not exist.

- [ ] **Step 3: Create strict parsing helpers**

Create `browsercli/src/commands/browser.ts`. Use these exact approved flag sets and value helpers:

```ts
import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

import {parseArgs} from '../args-parser.js';
import {toAxiError} from '../errors.js';
import {successOutput, tableOutput} from '../output.js';
import type {WorkerContext} from '../types.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
} from '../WorkerHttpClient.js';

const CONNECT_FLAGS = new Set([
  'accept-insecure-certs',
  'browser-url',
  'channel',
  'cloak',
  'executable-path',
  'full-stealth-args',
  'headless',
  'isolated',
  'js-stealth',
  'json',
  'minimal-stealth',
  'user-data-dir',
  'viewport',
  'ws-endpoint',
  'ws-headers',
]);
const READ_FLAGS = new Set(['json']);
const CHANNELS = new Set([
  'stable',
  'beta',
  'dev',
  'canary',
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'chromium',
  'bidi-chromium',
  'bidi-chrome',
  'bidi-chrome-beta',
  'bidi-chrome-dev',
  'bidi-chrome-canary',
  'firefox',
  'moz-firefox',
]);

function invalid(message: string): never {
  throw new AxiError(message, 'VALIDATION_ERROR', [
    '用法：browsercli browser connect|disconnect|status [options]',
  ]);
}

function assertFlags(
  flags: Record<string, string | boolean>,
  allowed: Set<string>,
): void {
  const unknown = Object.keys(flags).find(key => !allowed.has(key));
  if (unknown) invalid(`未知参数：--${unknown}`);
}

function stringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  if (!(key in flags)) return undefined;
  const value = flags[key];
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`--${key} 缺少值`);
  }
  return value;
}

function booleanFlag(
  flags: Record<string, string | boolean>,
  key: string,
): boolean | undefined {
  if (!(key in flags)) return undefined;
  const value = flags[key];
  if (typeof value === 'boolean') return value;
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return invalid(`--${key} 必须是 true 或 false`);
}

function urlFlag(
  flags: Record<string, string | boolean>,
  key: string,
  protocols: string[],
): string | undefined {
  const value = stringFlag(flags, key);
  if (value === undefined) return undefined;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    return invalid(`--${key} 不是合法 URL`);
  }
  if (!protocols.includes(protocol)) {
    return invalid(`--${key} 必须使用 ${protocols.join(' 或 ')}`);
  }
  return value;
}

function headersFlag(
  flags: Record<string, string | boolean>,
): Record<string, string> | undefined {
  const raw = stringFlag(flags, 'ws-headers');
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('--ws-headers 必须是合法 JSON');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some(item => typeof item !== 'string')
  ) {
    return invalid('--ws-headers 必须是字符串键值对象');
  }
  return value as Record<string, string>;
}

function viewportFlag(
  flags: Record<string, string | boolean>,
): {width: number; height: number} | undefined {
  const raw = stringFlag(flags, 'viewport');
  if (raw === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) return invalid('--viewport 格式必须为 宽x高');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) return invalid('--viewport 宽高必须大于 0');
  return {width, height};
}
```

- [ ] **Step 4: Implement connect config mapping and command dispatch**

Continue the same file with explicit mapping; do not pass raw flags through:

```ts
function connectOptions(
  flags: Record<string, string | boolean>,
): BrowserConnectOptions {
  assertFlags(flags, CONNECT_FLAGS);
  const browserURL = urlFlag(flags, 'browser-url', ['http:', 'https:']);
  const wsEndpoint = urlFlag(flags, 'ws-endpoint', ['ws:', 'wss:']);
  const channel = stringFlag(flags, 'channel');
  const executablePath = stringFlag(flags, 'executable-path');
  const remote = browserURL !== undefined || wsEndpoint !== undefined;
  const local = channel !== undefined || executablePath !== undefined;
  if (
    (browserURL !== undefined && wsEndpoint !== undefined) ||
    (channel !== undefined && executablePath !== undefined) ||
    (remote && local)
  ) {
    invalid('连接目标参数互斥');
  }
  if (channel !== undefined && !CHANNELS.has(channel)) {
    invalid(`不支持的浏览器 channel：${channel}`);
  }

  const options: BrowserConnectOptions = {};
  if (browserURL !== undefined) options.browserURL = browserURL;
  if (wsEndpoint !== undefined) options.wsEndpoint = wsEndpoint;
  if (channel !== undefined) options.channel = channel;
  if (executablePath !== undefined) options.executablePath = executablePath;

  const wsHeaders = headersFlag(flags);
  const viewport = viewportFlag(flags);
  const userDataDir = stringFlag(flags, 'user-data-dir');
  if (wsHeaders !== undefined) options.wsHeaders = wsHeaders;
  if (viewport !== undefined) options.viewport = viewport;
  if (userDataDir !== undefined) options.userDataDir = userDataDir;

  const booleans = {
    acceptInsecureCerts: booleanFlag(flags, 'accept-insecure-certs'),
    cloak: booleanFlag(flags, 'cloak'),
    fullStealthArgs: booleanFlag(flags, 'full-stealth-args'),
    headless: booleanFlag(flags, 'headless'),
    isolated: booleanFlag(flags, 'isolated'),
    jsStealth: booleanFlag(flags, 'js-stealth'),
    minimalStealth: booleanFlag(flags, 'minimal-stealth'),
  };
  for (const [key, value] of Object.entries(booleans)) {
    if (value !== undefined) {
      (options as Record<string, unknown>)[key] = value;
    }
  }
  return options;
}

function renderBrowserStatus(
  action: 'connect' | 'disconnect' | 'status',
  state: BrowserConnectionStatus,
  json: boolean,
) {
  const result = {command: 'browser', action, ...state};
  if (json) return successOutput(result);
  return {
    ...tableOutput(
      ['Property', 'Value'],
      [
        ['Connected', String(state.connected)],
        ['Mode', state.mode],
        ['Pages', String(state.pages)],
      ],
    ),
    ...result,
  };
}

export const browserCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const action = parsed.positionals[0];
  if (
    parsed.positionals.length !== 1 ||
    !['connect', 'disconnect', 'status'].includes(action)
  ) {
    invalid('浏览器动作必须是 connect、disconnect 或 status');
  }
  const typedAction = action as 'connect' | 'disconnect' | 'status';
  assertFlags(
    parsed.flags,
    typedAction === 'connect' ? CONNECT_FLAGS : READ_FLAGS,
  );
  const json = booleanFlag(parsed.flags, 'json') ?? false;
  const client = ctx?.httpClient;
  if (!client) throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');

  try {
    const state =
      typedAction === 'connect'
        ? await client.connectBrowser(connectOptions(parsed.flags))
        : typedAction === 'disconnect'
          ? await client.disconnectBrowser()
          : await client.getBrowserStatus();
    return renderBrowserStatus(typedAction, state, json);
  } catch (error) {
    throw toAxiError(error, 'BROWSER_ERROR');
  }
};
```

- [ ] **Step 5: Run browsercli tests and typecheck**

```powershell
npm --prefix browsercli test
npm --prefix browsercli run typecheck
```

Expected: all package tests and typecheck pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add -- browsercli/src/commands/browser.ts browsercli/tests/unit/browser.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "feat(browsercli): add browser control command"
```

---

### Task 6: Register and Document the CLI Command Group

**Files:**

- Modify: `browsercli/src/app.ts:9-27`
- Modify: `browsercli/src/help.ts:11-90`
- Modify: `browsercli/tests/unit/help.test.ts:11-105`
- Modify: `browsercli/tests/unit/browser.test.ts`

**Interfaces:**

- Consumes: Task 5 `browserCommand`.
- Produces: `cliCommands.browser` and help for all three browser actions.

- [ ] **Step 1: Add failing registry and help assertions**

In `help.test.ts`, assert top-level help contains `browser`, add a browser command-help test, and include it in the kept command list:

```ts
it('returns help for browser control', () => {
  const result = generateCommandHelp('browser');
  assert.ok(result);
  assert.ok(result.includes('browser connect'));
  assert.ok(result.includes('browser disconnect'));
  assert.ok(result.includes('browser status'));
});
```

In `browser.test.ts`, import `cliCommands` and add:

```ts
it('registers browser as a top-level command', () => {
  assert.strictEqual(cliCommands.browser, browserCommand);
});
```

- [ ] **Step 2: Run browsercli tests and verify RED**

```powershell
npm --prefix browsercli test
```

Expected: help and registry assertions fail because `browser` is not registered.

- [ ] **Step 3: Register the command and add exact help text**

In `app.ts`, import `browserCommand` and add it to `cliCommands`:

```ts
browser: browserCommand,
```

In `help.ts`, add the description, include `browser` in the default list, and add:

```ts
browser: {
  description: '连接、断开或查看 Worker 浏览器状态',
  usage: [
    'browsercli browser connect [options]',
    'browsercli browser disconnect [--json]',
    'browsercli browser status [--json]',
  ].join('\n         '),
},
```

The top-level order is `call`, `list-tools`, `browser`, `config`, `scaffold`, `status`.

- [ ] **Step 4: Run browsercli tests and typecheck**

```powershell
npm --prefix browsercli test
npm --prefix browsercli run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- browsercli/src/app.ts browsercli/src/help.ts browsercli/tests/unit/help.test.ts browsercli/tests/unit/browser.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(browsercli): expose browser command help"
```

---

### Task 7: Final Diff-Bounded Verification

**Files:**

- Verify only; do not edit generated `build/` output or unrelated user files.

**Interfaces:**

- Consumes: Tasks 1-6 and the approved design.
- Produces: fresh evidence for the final code state.

- [ ] **Step 1: Inspect the complete task diff**

```powershell
git status --short
git log --oneline -7
git diff HEAD~6 -- src/worker/BrowserConnectionManager.ts src/web/routes/apiV1.ts src/web/ConsoleServer.ts tests/unit/worker/BrowserConnectionManager.test.ts tests/unit/web/routes/apiV1.browser.test.ts browsercli/src/WorkerHttpClient.ts browsercli/src/commands/browser.ts browsercli/src/app.ts browsercli/src/help.ts browsercli/tests/unit/WorkerHttpClient.browser.test.ts browsercli/tests/unit/browser.test.ts browsercli/tests/unit/help.test.ts
```

Confirm each changed line maps to the feature and that pre-existing user hunks are neither reverted nor included in the six feature commits.

- [ ] **Step 2: Run focused tests after the last code change**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/worker/BrowserConnectionManager.test.js build/tests/unit/web/routes/apiV1.browser.test.js
npm --prefix browsercli test
```

Expected: every command exits 0 with zero failing tests.

- [ ] **Step 3: Run required type and formatting gates**

```powershell
npm --prefix browsercli run typecheck
npm run typecheck
npm run test:unit
npm run check-format
```

Expected: every command exits 0. If a command fails, repair only the task-owned cause and rerun that command plus any invalidated gate after the final edit.

- [ ] **Step 4: Run dependency security checks before the final handoff**

```powershell
npm audit
npm --prefix browsercli audit
```

Expected: no unresolved vulnerability introduced by this change. Because no dependency changes are planned, any pre-existing advisory must be recorded separately and must not be “fixed” by an unrelated dependency upgrade.

- [ ] **Step 5: Reinspect the final state and report evidence**

```powershell
git diff --check
git diff --cached --name-only
git status --short --branch
```

Report changed files by purpose, every verification command as passed/failed/not run, any failure→repair→rerun chain, pre-existing dirty files, and all unverified boundaries. Do not claim completion if a required gate still fails.
