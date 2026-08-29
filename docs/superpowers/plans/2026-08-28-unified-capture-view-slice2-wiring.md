# 统一抓包视图 · 切片 2（接线）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把切片 1 建好的 Session 持久层接上两个真实生产者——CDP（`BrowserContext.on('response')`）与 MITM（exchange 水槽）——并把摘要经新的 `session.request` WS 频道推出去、经新的 `/api/session/requests` REST 暴露出去。**旧链路（`proxy.request` 频道 + `ProxyStore` 桥接 + `/api/proxy/requests`）一律保留并存**，使本切片可随时回退。

**Architecture:** `SessionCaptureBridge` 在 context 级挂 `response` 监听 → `CdpRequestAdapter` → `CaptureEngine.ingestRequest`；`MitmModule.recordExchange()` 把 exchange 同时喂给 `ProxyStore`（旧）与可选 `onExchange` 水槽（新，内部 try/catch）→ `MitmRequestAdapter` → `CaptureEngine.ingestRequest`。`CaptureEngine` 是唯一聚合点，落库成功后 `emitToWs({type:'session.request', payload: toSummary(row)})`；`ConsoleServer.start()` 晚绑定该回调，按「已注册频道白名单 + 零订阅者短路」转发到 `WsHub`。body/headers 的唯一出口是 `GET /api/session/requests/:id`。

**Tech Stack:** TypeScript ESM（Node `^20.19.0 || ^22.12.0 || >=23`）、`better-sqlite3`、`patchright`、`node:test`（经 `npm run build` 后跑 `build/tests/**`）、Prettier + ESLint。

**Spec:** `docs/superpowers/specs/2026-08-28-unified-capture-view-design.md`（r2.1；本计划实现其 §14 的「切片 2」，对应 §3/§4 接线部分、§5 映射、§8 频道与桥接、§9 REST、§11 测试矩阵后三行）

**前置：** 切片 1（后端地基）已合入本分支。开工前 `git log --oneline -12` 应能看到切片 1 的 9 个 commit；`src/modules/session/{CaptureEngine,SqliteSessionStore,summary,adapters/*}.ts`、`src/runtime.ts` 的 `captureEngine?`、`ServiceLocator.getCaptureEngine()` 均已就位。

---

## Global Constraints

- Node 版本：`^20.19.0 || ^22.12.0 || >=23`（`package.json` engines）。
- Prettier：`singleQuote: true`、`trailingComma: 'all'`、`arrowParens: 'avoid'`、`endOfLine: 'lf'`、`bracketSpacing: false`（`.prettierrc.cjs`）。
- ESLint：导入按字母序分组（`node:` 内置 → 裸包 → 上级 `../../`/`../` → 同级 `./`），组间空一行、组内按路径字符串不区分大小写排序；类型导入必须显式 `import type`；优先 `interface` 而非 `type` 对象；Node 内置模块加 `node:` 前缀。报 `import/order` 时跑 `npx eslint --fix <file>` 后重跑，**不要手工猜顺序**。
- 每个文件顶部保留 `@license` 头。`src/modules/session/**` 与 `src/web/routes/proxy.ts` 用 `Copyright 2026 Google LLC`；`src/worker/**` 与 `src/web/ConsoleServer.ts` 用 `Copyright 2026 Browser-CLI`；`tests/unit/**` 跟随同目录既有文件，新建的 `tests/integration/web/**` 用 `Copyright 2026 Google LLC`。
- 测试目录镜像源码：`src/worker/context/X.ts` → `tests/unit/worker/context/X.test.ts`；`src/web/routes/X.ts` 的路由层用例 → `tests/integration/web/X.integration.test.ts`。
- **并存红线（切片 2 的定义）**：不得删除 `onProxyCaptureListener`（`ConsoleServer.ts:306-319`）及其 `stop()` 解绑（`:348-352`）；不得从 `StreamChannel` / `VALID_CHANNELS` 移除 `proxy.request`；不得改 `src/web-ui/**`（前端切源是切片 3）；不得改 `src/tools/**`；不得改 `NetworkRequestCollector`（spec §12）。
- **防御式访问红线**：`Runtime.captureEngine` 是可选字段且 mock runtime 没有它——所有新增调用点一律 `?.` 或 `undefined` 守卫（spec §7 约束 1）。`tests/unit/web/ConsoleServer.test.ts` 的 mock runtime 只有 `browserManager` / `hookManager` 两项，这是真实场景不是测试缺陷。
- **生产者回调绝不抛**（spec §4 / R3）：CDP 的 `response` 监听回调、MITM 的 exchange 回调内部必须 try/catch，落库失败只 `logger.warn`。
- 常量单一来源：`CDP_BODY_CAPTURE_ENABLED` / `CDP_BODY_TIMEOUT_MS` / `MAX_CAPTURED_BODY_BYTES` 在 `src/modules/network/constants.ts`；`LIST_DEFAULT_LIMIT` / `LIST_MAX_LIMIT` 在 `src/modules/session/constants.ts`。**不要再写第二份字面量**——`listRequestSummaries`（`SqliteSessionStore.ts:323-327`）已经在 SQL 侧做了 clamp，路由层只做整数解析。
- 每个 Task 收尾必跑：`npm run typecheck` + 该 Task 的测试 + **文件级**门禁（`npx prettier --check <本 Task 改动文件>`、`npx eslint <同前>`）；最后一次改动后重跑同一组检查（AGENTS.md「最终变更验证闭环」）。
- **不要用 `npm run check-format` 当门禁**：`eslint --cache .` 会连 `open-source/` 一起扫并在默认堆下 OOM；`prettier --check --cache .` 对 402 个文件报 warn（vendored 文档为主）。这些是既有债务，本切片不得顺手全量格式化。
- 提交信息用 Conventional Commits（`feat(session): ...` / `feat(web): ...` / `refactor(worker): ...` / `test(...)`）。
- **工作区卫生**：每个 Task 的 `git add` 只列本 Task 显式文件，**禁止 `git add -A` / `git commit -a`**；提交前用 `git status --porcelain` 确认暂存区只有自己的文件。
- 单测运行模板（把 `<path>` 换成 build 下路径）：

  ```bash
  npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/<path>.test.js
  ```

- 根 `tsconfig.json` 是**松**配置（`strict: false`、`noImplicitAny: false`、`noUnusedLocals: false`），`npm run typecheck` **不会**帮我们抓漏掉的 `?.` 或可选链——那些只能靠测试暴露。每个新增的可选访问点必须有对应的断言。
- 只要动了 `src/web/types.ts`，收尾就必须加跑 `npm run web:typecheck`：`src/web-ui/src/lib/protocol.ts:13` 整体 `export *` 透传该文件，而 `src/web-ui/tsconfig.json` 是 `strict: true` + `noUnusedLocals: true`。

---

### Task 0: 记录切片 2 开工前的基线

**Files:** 无（只测不改）

**Interfaces:**

- Consumes: 无
- Produces: 一份「开工前基线」，后续所有 “Expected: 不新增红” 都相对它判断

- [ ] **Step 1: 跑全量单测并记下红名单**

Run:

```powershell
npm run build
$env:NODE_OPTIONS = "--max-old-space-size=8192"
npm run test:unit 2>&1 | Tee-Object .baseline_unit.txt | Select-String '^# (tests|pass|fail)'
(Select-String -Path .baseline_unit.txt -Pattern '^not ok ').Line
Remove-Item .baseline_unit.txt
```

Expected: 记下 `# tests / # pass / # fail` 与 `not ok` 名单。**必须开工时实测填写**，不得照抄任何历史数字（切片 1 收尾时是 1563/1506/57，但此后分支上又合入了其它 commit，HEAD 已不是那个点）。

> 先把 `npm run build` **单独**跑一条：`npm run test:unit` 自身以 build 开头，构建失败时它的报错会被 `2>&1 | Tee-Object` 混进基线文件，让「基线」看起来像是一堆测试红、而实际只是没编译过。确认构建干净后再收集基线。

- [ ] **Step 2: 确认本切片涉及的测试文件当前全绿**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ws/WsHub.test.js build/tests/unit/web/ConsoleServer.test.js build/tests/unit/web/routes/proxy.test.js build/tests/unit/worker/CollectorContextProvider.test.js build/tests/unit/modules/proxy/MitmModule.test.js build/tests/unit/runtime/RuntimeServices.test.js build/tests/integration/session/session-ai-pipeline.integration.test.js
```

Expected: 全 PASS。这 7 个文件是本切片要动或要扩展的；其中任一当前是红的，先在 Task 0 里记清楚，后面才能区分「既有红」与「我引入的红」。

- [ ] **Step 3: 确认切片 1 的地基确实在**

Run: `git log --oneline -12` 且 `Select-String` 检查以下几处都在：

- `src/runtime.ts` 有 `captureEngine?: CaptureEngine;` 与 `get captureEngine()`
- `src/worker/ServiceLocator.ts` 有 `getCaptureEngine(): CaptureEngine | undefined`
- `src/modules/session/adapters/index.ts` 导出了 `fromCdpResponse` / `fromMitmExchange`
- `src/modules/session/SqliteSessionStore.ts` 有 `getRequest` / `listRequestSummaries` / `trimRequests`

Expected: 四项都在。缺任一项 = 切片 1 没合进来，停下找人，不要自己补地基。

---

### Task 1: WS 频道与协议类型（`session.request`）

**Files:**

- Modify: `src/web/types.ts`（`StreamChannel` :38-43；新增 Session 类型区）
- Modify: `src/web/ws/WsHub.ts:49-56`（`VALID_CHANNELS`）
- Test: `tests/unit/web/ws/WsHub.test.ts`（扩展）

**Interfaces:**

- Consumes: `src/modules/session/types.ts` 的 `CapturedRequestSummary` / `CaptureSource`（仅类型，运行时零依赖）
- Produces:
  - `StreamChannel` 新增 `'session.request'` → `Channel` 联合自动带上
  - `SessionRequestSummaryEvent`（= `CapturedRequestSummary` 的别名重新导出）
  - `SessionRequestDetail`（REST 详情响应体）
  - `VALID_CHANNELS` 含 `'session.request'`

> **对 spec §4 的一处有意偏离（写死，不留半改状态）**：§4 列了 `SessionRequestSummaryEvent` / `SessionRequestSummary` / `SessionRequestDetail` 三个名字，但前两者结构逐字相同（§9 的列表项就是 `toSummary()` 的输出）。本计划只落地**两个**：`SessionRequestSummaryEvent`（WS 与 REST 列表共用）与 `SessionRequestDetail`。同一份投影留两个名字只会让它们日后分叉。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/web/ws/WsHub.test.ts` 的 `describe('WsHub')` 末尾追加两个用例（放在最后的 `});` 之前）：

```ts
  it('accepts session.request as a registered stream channel', () => {
    hub.subscribe(ws, 'session.request');
    assert.strictEqual(hub.getSubscriberCount('session.request'), 1);

    hub.broadcast('session.request', {
      id: 's1-1',
      sessionId: 's1',
      sequence: 1,
      timestamp: 1700000000000,
      method: 'GET',
      url: 'https://a.dev/api',
      statusCode: 200,
      contentType: 'application/json',
      source: 'cdp',
      truncated: 0,
      isStreaming: 0,
    });

    assert.strictEqual(ws.sent.length, 1);
    const evt = ws.sent[0] as {channel: string; payload: Record<string, unknown>};
    assert.strictEqual(evt.channel, 'session.request');
    assert.strictEqual(evt.payload['id'], 's1-1');
    assert.strictEqual(
      'responseBody' in evt.payload,
      false,
      'WS 面只承载摘要，不得带 body（spec §8 / R1）',
    );
  });

  it('still rejects engine channels that are not registered', () => {
    // ingestHook / ingestSnapshot 会 emit 这两个 type，但切片 2 不注册它们：
    // WsHub 必须照旧拒绝，而不是静默接受后被 ConsoleServer 的桥接丢掉。
    hub.subscribe(ws, 'session.hook' as never);
    assert.strictEqual(ws.sent.length, 1);
    const err = ws.sent[0] as {type: string; code: string};
    assert.strictEqual(err.code, 'INVALID_CHANNEL');
    assert.strictEqual(hub.getSubscriberCount('session.hook' as never), 0);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ws/WsHub.test.js`
Expected: 第一个用例失败（`'session.request'` 不在 `VALID_CHANNELS`，订阅被拒 → `ws.sent.length === 0`）。第二个用例当前**会通过**（因为它断言的正是「未注册」）——它是一条**回归护栏**，防止后来有人把 `session.hook` 顺手加进白名单。

- [ ] **Step 3: 扩展 `StreamChannel` 并新增 Session 类型区**

`src/web/types.ts` —— 把 `:38-43` 改成：

```ts
export type StreamChannel =
  | 'tool.invoke'
  | 'hook.event'
  | 'hook.sample'
  | 'log'
  | 'proxy.request'
  | 'session.request';
```

在文件末尾（`GetMitmRequestData` 之后）追加：

```ts
// ==================== Session Capture Types (channel: session.request) ====================

import type {
  CapturedRequestSummary,
  CaptureSource,
} from '../modules/session/types.js';

/**
 * WS 推送与 REST 列表项的摘要投影。
 *
 * 别名到 session 领域的 CapturedRequestSummary —— 投影逻辑单点在
 * src/modules/session/summary.ts，本文件只做重新导出（spec §8）。
 * src/web-ui/src/lib/protocol.ts 会整体透传给前端。
 */
export type {CapturedRequestSummary as SessionRequestSummaryEvent};

/**
 * REST 详情响应体（GET /api/session/requests/:id）。
 *
 * 与摘要的区别只有一处：headers 已解析成对象，并额外带 body。
 * `headersParseError` 为 true 表示库中 headers 不是合法 JSON 对象，
 * 已降级为 `{}`（spec §9）——前端据此提示，而不是白屏。
 */
export interface SessionRequestDetail {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  source: CaptureSource;
  durationMs: number;
  initiator: string | null;
  truncated: number;
  isStreaming: number;
  isWebSocket: number;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  headersParseError?: true;
}
```

> `import type` 放在文件中段（而非顶部）是为了让这段类型自解释；ESLint 的 `import/first` 若报，跑 `npx eslint --fix src/web/types.ts` 后确认结果——若它把 import 提到顶部，接受它的结果，不要手工改回去。

- [ ] **Step 4: `WsHub` 注册频道**

`src/web/ws/WsHub.ts` 的 `VALID_CHANNELS`（`:49-56`）数组里、`'proxy.request',` 之后加一行 `'session.request',`：

```ts
const VALID_CHANNELS: ReadonlySet<Channel> = new Set<Channel>([
  ...STATE_CHANNELS,
  'tool.invoke',
  'hook.event',
  'hook.sample',
  'log',
  'proxy.request', // 切片 2 期间与 session.request 并存，切片 3 才下线
  'session.request',
]);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ws/WsHub.test.js`
Expected: 全 PASS（11 → 13 个用例；开工时数一遍 `grep -c "it('" tests/unit/web/ws/WsHub.test.ts`，若不是 11 以实测为准，新用例是 +2）。

Run: `npm run typecheck && npm run web:typecheck`
Expected: 两者都通过。`web:typecheck` 是硬要求——`SessionRequestDetail` 已经透传到前端的 strict 编译域。

Run: `npx prettier --check src/web/types.ts src/web/ws/WsHub.ts tests/unit/web/ws/WsHub.test.ts && npx eslint src/web/types.ts src/web/ws/WsHub.ts tests/unit/web/ws/WsHub.test.ts`
Expected: 零告警。

- [ ] **Step 6: 提交**

```bash
git add src/web/types.ts src/web/ws/WsHub.ts tests/unit/web/ws/WsHub.test.ts
git commit -m "feat(web): register session.request channel and its protocol types"
```

---

### Task 2: `SessionCaptureBridge`（CDP 生产者）

**Files:**

- Create: `src/worker/context/SessionCaptureBridge.ts`
- Test: `tests/unit/worker/context/SessionCaptureBridge.test.ts`（新目录 `tests/unit/worker/context/`，镜像 `src/worker/context/`）

**Interfaces:**

- Consumes:
  - `fromCdpResponse(response, opts)`（`src/modules/session/adapters/index.js`，切片 1 已建）
  - `CaptureEngine.ingestRequest(input)`（切片 1 已建）
  - `CDP_BODY_CAPTURE_ENABLED`（`src/modules/network/constants.ts:33`）
  - `patchright` 的 `BrowserContext.on/off('response')` —— 已核实 `node_modules/patchright-core/types/types.d.ts:1221` 有 `on(event:'response', listener:(response: Response)=>any): this`、`:1714` 有 `off` 同签名，类型完备无需 `as any`
- Produces:
  - `class SessionCaptureBridge`：`attach(context)` / `detach()` / `getDroppedCount()`
  - 幂等：同一 context 重复 `attach` 不重复挂监听（`ToolContext.init()` 与 `setContext()` 都会调 `start()`）

> **为什么不从 `src/modules/session/index.js` 拿适配器**：该 barrel 未重新导出 `./adapters/index.js`。本切片不扩 barrel（避免把 adapter 提升成公共 API），直接按全路径引 `../../modules/session/adapters/index.js`。

> **适配器签名（已核实，照抄勿改）**：`CdpRequestAdapter.ts` 导出 `CdpBodyReader`（:17）、`CdpAdapterOptions {readBody?: CdpBodyReader; now?: () => number}`（:19-22）、`readCdpResponseBody`（:36）、`cdpResponseToInput`（:61）。**没有** `captureBody` 布尔开关——关体取要传 `readBody: () => Promise.resolve(null)` 替身。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/worker/context/SessionCaptureBridge.test.ts`（`@license` 头跟随 `tests/unit/worker/**` 的既有文件）：

```ts
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {BrowserContext, Response} from 'patchright';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import {SessionCaptureBridge} from '../../../../src/worker/context/SessionCaptureBridge.js';

function makeEngine(): {engine: CaptureEngine; manager: CaptureSessionManager} {
  const db = new DatabaseManager(':memory:');
  const store = new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  return {engine: new CaptureEngine(manager, store), manager};
}

function makeContext(): {
  context: BrowserContext;
  emit: (response: Response) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(response: Response) => void>();
  const context = {
    on: (event: string, handler: (response: Response) => void) => {
      if (event === 'response') listeners.add(handler);
      return context;
    },
    off: (event: string, handler: (response: Response) => void) => {
      if (event === 'response') listeners.delete(handler);
      return context;
    },
  } as unknown as BrowserContext;
  return {
    context,
    emit: response => {
      for (const listener of [...listeners]) listener(response);
    },
    listenerCount: () => listeners.size,
  };
}

function makeResponse(
  overrides: Partial<{url: string; body: string}> = {},
): Response {
  const headers = {'content-type': 'application/json'};
  const request = {
    method: () => 'GET',
    url: () => overrides.url ?? 'https://a.dev/api/sign',
    headers: () => ({cookie: 'x=1'}),
    postData: () => null,
  };
  return {
    status: () => 200,
    headers: () => headers,
    request: () => request,
    text: async () => overrides.body ?? '{"ok":true}',
  } as unknown as Response;
}

/** 监听回调内部是 async 摄入；等一个宏任务即可落到库里。 */
const flush = (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve));

describe('SessionCaptureBridge', () => {
  it('ingests a CDP response into the engine', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine);

    bridge.attach(context);
    emit(makeResponse());
    await flush();

    const session = manager.getActiveSession();
    assert.ok(session, '首次摄入应自动建默认会话（spec §6）');
    const rows = manager.getRequests(session.id);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]!.source, 'cdp');
    assert.strictEqual(rows[0]!.responseBody, '{"ok":true}');
    assert.strictEqual(rows[0]!.url, 'https://a.dev/api/sign');
  });

  it('is idempotent for repeated attach on the same context', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit, listenerCount} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine);

    bridge.attach(context);
    bridge.attach(context);
    bridge.attach(context);
    assert.strictEqual(listenerCount(), 1, 'init() 与 setContext() 都会调 start()');

    emit(makeResponse());
    await flush();

    const session = manager.getActiveSession()!;
    assert.strictEqual(manager.getRequests(session.id).length, 1);
  });

  it('does nothing when no engine is available', async () => {
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => undefined);

    assert.doesNotThrow(() => bridge.attach(context));
    emit(makeResponse());
    await flush();
    assert.strictEqual(bridge.getDroppedCount(), 0);
  });

  it('stops ingesting after detach', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit, listenerCount} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine);

    bridge.attach(context);
    bridge.detach();
    assert.strictEqual(listenerCount(), 0);
    emit(makeResponse());
    await flush();

    assert.strictEqual(
      manager.getActiveSession(),
      null,
      'detach 后不应再产生会话/行',
    );
  });

  it('never lets an ingest failure escape into the Playwright callback', async () => {
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(
      () =>
        ({
          ingestRequest: () => {
            throw new Error('boom');
          },
        }) as unknown as CaptureEngine,
    );

    bridge.attach(context);
    // emit 同步返回：异常若逃出回调，Playwright 会把它当监听器错误抛出
    emit(makeResponse());
    await flush();

    assert.strictEqual(bridge.getDroppedCount(), 1, 'spec §4 / R3：生产者回调绝不抛');
  });

  it('skips the body when CDP body capture is disabled', async () => {
    const {engine, manager} = makeEngine();
    const {context, emit} = makeContext();
    const bridge = new SessionCaptureBridge(() => engine, {captureBody: false});

    bridge.attach(context);
    emit(makeResponse());
    await flush();

    const session = manager.getActiveSession()!;
    const rows = manager.getRequests(session.id);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]!.responseBody, null);
    assert.strictEqual(
      rows[0]!.contentType,
      'application/json',
      '关掉取体不该影响 contentType',
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建通过（swc 容忍悬空引用），但运行报 `ERR_MODULE_NOT_FOUND ... build/src/worker/context/SessionCaptureBridge.js`。这正是 RED——实现还不存在。

- [ ] **Step 3: 实现 `SessionCaptureBridge`**

创建 `src/worker/context/SessionCaptureBridge.ts`（`@license` 跟随同目录的 `CollectorContextProvider.ts`）：

```ts
import type {BrowserContext, Response} from 'patchright';

import type {CdpBodyReader} from '../../modules/session/adapters/CdpRequestAdapter.js';
import {fromCdpResponse} from '../../modules/session/adapters/index.js';
import {CDP_BODY_CAPTURE_ENABLED} from '../../modules/network/constants.js';
import type {CaptureEngine} from '../../modules/session/index.js';
import type {CapturedRequestInput} from '../../modules/session/types.js';
import {logger} from '../../utils/logger.js';

export interface SessionCaptureBridgeOptions {
  /** 是否主动取响应体；缺省读 CDP_BODY_CAPTURE_ENABLED（spec §13-D3）。 */
  captureBody?: boolean;
  now?: () => number;
}

/** 关掉取体时的替身：不 await response.text()，省掉 SSE/大体的开销。 */
const skipBody: CdpBodyReader = () => Promise.resolve(null);

/**
 * CDP 抓包链路的挂载点（spec §4）。
 *
 * 三条硬约束：
 * 1. **绝不向 Playwright 抛**：监听回调里的一切（adapter 取体、落库）都包在
 *    try/catch 里，失败只 warn + 计数（spec §4 / R3）。
 * 2. **engine 每次事件现取**：worker 侧的 ToolContext 可能早于 runtime 服务就绪，
 *    构造期拿不到 engine，故注入的是取值函数而非实例。
 * 3. **attach 幂等**：ToolContext.init() 与 setContext() 都会调 start()，
 *    重复挂载会让同一响应入库两次。
 */
export class SessionCaptureBridge {
  private context: BrowserContext | null = null;
  private listener: ((response: Response) => void) | null = null;
  private dropped = 0;

  constructor(
    private readonly getEngine: () => CaptureEngine | undefined,
    private readonly opts: SessionCaptureBridgeOptions = {},
  ) {}

  attach(context: BrowserContext): void {
    if (this.listener) {
      if (this.context === context) return;
      this.detach();
    }
    const listener = (response: Response): void => {
      void this.ingest(response);
    };
    context.on('response', listener);
    this.context = context;
    this.listener = listener;
  }

  detach(): void {
    if (this.context && this.listener) {
      try {
        this.context.off('response', this.listener);
      } catch {
        // context 已关闭，忽略
      }
    }
    this.context = null;
    this.listener = null;
  }

  /** 摄入失败累计次数（只用于观测与测试）。 */
  getDroppedCount(): number {
    return this.dropped;
  }

  private async ingest(response: Response): Promise<void> {
    const engine = this.getEngine();
    if (!engine) return;
    try {
      const input: CapturedRequestInput = await fromCdpResponse(response, {
        ...(this.opts.now ? {now: this.opts.now} : {}),
        ...(this.captureBodyEnabled() ? {} : {readBody: skipBody}),
      });
      engine.ingestRequest(input);
    } catch (error) {
      this.dropped += 1;
      logger.warn(
        `[SessionCaptureBridge] CDP 响应摄入失败，已丢弃第 ${this.dropped} 条`,
        error,
      );
    }
  }

  private captureBodyEnabled(): boolean {
    return this.opts.captureBody ?? CDP_BODY_CAPTURE_ENABLED;
  }
}
```

> `import/order` 提示：裸包组只有 `patchright`；上级组按路径不区分大小写排序为 `../../modules/network/constants.js` → `../../modules/session/adapters/CdpRequestAdapter.js` → `../../modules/session/adapters/index.js` → `../../modules/session/index.js` → `../../modules/session/types.js` → `../../utils/logger.js`。若 ESLint 给出的稳定顺序与此不同，**以 `npx eslint --fix` 的结果为准**，不要手工调换。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/context/SessionCaptureBridge.test.js`
Expected: 6 个用例全 PASS。

Run: `npm run typecheck`
Expected: 通过。

Run: `npx prettier --check src/worker/context/SessionCaptureBridge.ts tests/unit/worker/context/SessionCaptureBridge.test.ts && npx eslint src/worker/context/SessionCaptureBridge.ts tests/unit/worker/context/SessionCaptureBridge.test.ts`
Expected: 零告警。

- [ ] **Step 5: 提交**

```bash
git add src/worker/context/SessionCaptureBridge.ts tests/unit/worker/context/SessionCaptureBridge.test.ts
git commit -m "feat(worker): add SessionCaptureBridge for CDP response capture"
```

---

### Task 3: 把 bridge 挂进 `CollectorContextProvider` / `ToolContext`

**Files:**

- Modify: `src/worker/context/CollectorContextProvider.ts`（构造函数 :30-36、`start()` :55-60、`dispose()` :71-76）
- Modify: `src/worker/ToolContext.ts:53`（注入取值函数）
- Test: `tests/unit/worker/CollectorContextProvider.test.ts`（扩展）

**Interfaces:**

- Consumes: `ServiceLocator.getCaptureEngine(): CaptureEngine | undefined`（切片 1 已建）
- Produces: `CollectorContextProvider` 接受**可选** engine 取值函数；`start(context)` 一并启 bridge，`dispose()` 解挂

> **必须保持可选**：`tests/unit/worker/CollectorContextProvider.test.ts:14/36` 的现状是 `new CollectorContextProvider()` 无参构造。缺省 `() => undefined` 让无 engine 场景（测试、早期 worker 生命周期）静默降级，与 `ServiceLocator` 的 `undefined` 语义一致。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/worker/CollectorContextProvider.test.ts` 末尾追加（需补 import：`DatabaseManager`、`CaptureEngine`、`CaptureSessionManager`、`SqliteSessionStore` 与 patchright 的 `BrowserContext`/`Response` 类型；导入顺序按 Global Constraints 交给 `npx eslint --fix`）：

```ts
  it('ingests CDP responses through the capture bridge when an engine is provided', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const listeners = new Set<(response: Response) => void>();
    const context = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') listeners.add(handler);
        return context;
      },
      off: (_event: string, handler: (response: Response) => void) => {
        listeners.delete(handler);
        return context;
      },
      pages: () => [],
    } as unknown as BrowserContext;

    const provider = new CollectorContextProvider(() => engine);
    provider.start(context);
    assert.ok(provider.isStarted());

    const response = {
      status: () => 200,
      headers: () => ({'content-type': 'text/plain'}),
      request: () => ({
        method: () => 'GET',
        url: () => 'https://b.dev/probe',
        headers: () => ({}),
        postData: () => null,
      }),
      text: async () => 'pong',
    } as unknown as Response;
    for (const listener of [...listeners]) listener(response);
    await new Promise(resolve => setImmediate(resolve));

    const session = manager.getActiveSession();
    assert.ok(session);
    assert.strictEqual(manager.getRequests(session.id).length, 1);

    provider.dispose();
    assert.strictEqual(listeners.size, 0, 'dispose 必须解挂 response 监听');
    db.close();
  });

  it('starts without an engine and stays silent on responses', () => {
    const provider = new CollectorContextProvider();
    const context = {
      on: () => context,
      off: () => context,
      pages: () => [],
    } as unknown as BrowserContext;

    assert.doesNotThrow(() => provider.start(context));
    assert.ok(provider.isStarted());
    assert.doesNotThrow(() => provider.dispose());
  });
```

> mock 的 context 只需 `on` / `off` / `pages()` 三项：已核实三个既有 collector 中只有 `PageCollector.startContextCollection`（`src/modules/collector/PageCollector.ts:108-122`）碰 context，调 `context.pages()` 与 `context.on('page', ...)`，`dispose()`（:127-134）里 `context.off('page', ...)`。缺 `pages()` 会让 RED 落在既有 collector 上而不是新 bridge 上——那不是我们要的 RED。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/CollectorContextProvider.test.js`
Expected: 新加的第一个用例失败（`start()` 不会挂 `response` 监听 → 落 0 行）；第二个用例当前通过（它断言的是缺省可选，属护栏）。

- [ ] **Step 3: 改建 `CollectorContextProvider`**

在文件顶部补 import（`../../modules/session/index.js` 与 `./SessionCaptureBridge.js`，顺序交 `npx eslint --fix`），然后改类体：

```ts
export class CollectorContextProvider {
  private readonly _networkCollector = new NetworkRequestCollector();
  private readonly _consoleCollector = new ConsoleMessageCollector();
  private readonly _wsCollector = new WsCollector();
  private readonly _captureBridge: SessionCaptureBridge;

  private readonly _maxNavigationSaved = 3;
  private _started = false;

  // ─── 生命周期 ────────────────────────────────────────

  /**
   * @param getCaptureEngine 抓包聚合点的延迟取值函数（worker 侧传
   *   `() => serviceLocator.getCaptureEngine()`）。缺省表示不抓包——无 engine 时
   *   bridge 对每个响应静默返回，不产生任何落库副作用（spec §7 约束 1）。
   */
  constructor(
    getCaptureEngine: () => CaptureEngine | undefined = () => undefined,
  ) {
    this._captureBridge = new SessionCaptureBridge(getCaptureEngine);
  }

  /** 供测试与未来的手动挂载点使用。 */
  get captureBridge(): SessionCaptureBridge {
    return this._captureBridge;
  }
```

`start(context)`（:55-60）末尾追加一行：

```ts
    this._captureBridge.attach(context);
    this._started = true;
```

`dispose()`（:71-76）末尾追加一行：

```ts
    this._captureBridge.detach();
    this._started = false;
```

- [ ] **Step 4: 改建 `ToolContext.ts:53`**

把

```ts
  private readonly _collectorContext = new CollectorContextProvider();
```

改成

```ts
  private readonly _collectorContext = new CollectorContextProvider(
    () => this._serviceLocator.getCaptureEngine(),
  );
```

> 字段初始化早于构造函数体，但箭头函数体内是**延迟求值**，所以 `_serviceLocator` 在首次响应事件时必然已赋值。`ToolContext.init()` :78 与 `setContext()` :139 已在调 `start()`、`dispose()` :97 已在调 `dispose()`，**无需改动这三个调用点**——这是本 Task 在 `ToolContext.ts` 里只动一行的原因。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/CollectorContextProvider.test.js build/tests/unit/worker/ToolContextProvider.test.js build/tests/unit/worker/ServiceLocator.test.js build/tests/unit/worker/context/SessionCaptureBridge.test.js`
Expected: 全 PASS。`ToolContextProvider.test.js` 是关键回归——它构造真实的 provider，若 bridge 在无 runtime 时抛错，这里会先红。若文件名与列表不符，先 `ls build/tests/unit/worker/` 校正。

Run: `npm run typecheck && npx prettier --check src/worker/context/CollectorContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/CollectorContextProvider.test.ts && npx eslint src/worker/context/CollectorContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/CollectorContextProvider.test.ts`
Expected: 零告警。

- [ ] **Step 6: 提交**

```bash
git add src/worker/context/CollectorContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/CollectorContextProvider.test.ts
git commit -m "feat(worker): mount SessionCaptureBridge from CollectorContextProvider"
```

---

### Task 4: MITM 生产者 —— `MitmModule` 的 exchange 水槽

**Files:**

- Modify: `src/modules/proxy/MitmModule.ts`（构造函数 :38-41、`start()` 的 server 回调 :56-60）
- Modify: `src/runtime/RuntimeServices.ts:84-86`（`getMitmModule()` 接线）
- Test: `tests/unit/modules/proxy/MitmModule.test.ts`（扩展）

**Interfaces:**

- Consumes:
  - `fromMitmExchange(exchange)` = `toCapturedRequestInput`（`src/modules/session/adapters/index.js`，切片 1 已建；签名 `(exchange: CapturedExchange) => CapturedRequestInput`，纯函数不抛）
  - `CaptureEngine.ingestRequest(input)`
- Produces:
  - `MitmModule` 第二个构造参数 `onExchange?: (exchange: CapturedExchange) => void`（可选）
  - 公共 `recordExchange(exchange)` —— 把「进 `ProxyStore`（旧链路）+ 进水槽（新链路）」收敛到一个可单测的方法；`start()` 的 server 回调改调它

> **为什么抽 `recordExchange`**：原来的 server 回调是 `exchange => { this.store.add(exchange); }`，挂在 `start()` 里，测试要造一个真 server 才能覆盖。抽出来后两个新增用例直接调 `mod.recordExchange(...)`，不需要 CA / 端口 / 网络——这是本 Task 唯一能低成本拿到 RED 的路。

> **红线**：`ProxyStore.add()` 必须在水槽**之前**调用，且水槽内部 try/catch（spec §4/R3）。旧链路不受新链路失败影响，这是「随时可回退」的技术前提。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/modules/proxy/MitmModule.test.ts` 末尾追加（需补 import：`DatabaseManager`、`CaptureEngine`、`CaptureSessionManager`、`SqliteSessionStore`、`fromMitmExchange`、`CapturedExchange` 类型；顺序交 `npx eslint --fix`）：

```ts
  it('feeds exchanges to the onExchange sink in addition to the store', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    const db = new DatabaseManager(':memory:');
    try {
      const store = new SqliteSessionStore(db);
      const manager = new CaptureSessionManager(store);
      const engine = new CaptureEngine(manager, store);
      const mod = new MitmModule(dir, exchange => {
        engine.ingestRequest(fromMitmExchange(exchange));
      });

      mod.recordExchange(makeExchange());

      // 旧链路仍然在（红线：并存）
      assert.strictEqual(mod.getStore().size(), 1);
      // 新链路已接线
      const session = manager.getActiveSession();
      assert.ok(session);
      const rows = manager.getRequests(session.id);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0]!.source, 'proxy');
      assert.strictEqual(rows[0]!.url, 'https://c.dev/api/token');
      assert.strictEqual(rows[0]!.statusCode, 200);
    } finally {
      rmSync(dir, {recursive: true, force: true});
      db.close();
    }
  });

  it('keeps the legacy store intact when the sink throws', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir, () => {
        throw new Error('boom');
      });

      assert.doesNotThrow(() => mod.recordExchange(makeExchange()));
      assert.strictEqual(
        mod.getStore().size(),
        1,
        'spec §4/R3：水槽失败不得影响 ProxyStore 与 MITM server 回调',
      );
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('works with no sink configured', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      assert.doesNotThrow(() => mod.recordExchange(makeExchange()));
      assert.strictEqual(mod.getStore().size(), 1);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
```

并在 `describe` 之前加一个 fixture（与本文件既有的 `mkdtempSync` 风格一致）：

```ts
/** 与 MitmProxyServer 交给回调的形状一致（src/modules/proxy/types.ts:8-24）。 */
function makeExchange(): CapturedExchange {
  return {
    requestId: 'r1',
    method: 'POST',
    url: 'https://c.dev/api/token',
    requestHeaders: {'content-type': 'application/json'},
    requestBody: '{"a":1}',
    statusCode: 200,
    responseHeaders: {'content-type': 'application/json'},
    responseBody: '{"token":"t"}',
    contentType: 'application/json',
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: Date.now(),
  };
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/MitmModule.test.js`
Expected: 已有的 3 个既有用例 PASS；新加 3 个报 `TypeError: mod.recordExchange is not a function`。这就是 RED。

- [ ] **Step 3: 改建 `MitmModule`**

补 import：`logger`（`../../../utils/logger.js`）、`fromMitmExchange`（`../session/adapters/index.js` 经 barrel 或全路径，与 Task 2 保持一致）、`CapturedExchange` 类型（`./types.js` 已有）。

```ts
  private readonly store: ProxyStore;
  private readonly caManager: CaManager;
  private server: MitmProxyServer | null = null;

  /**
   * @param certsDir CA 证书目录
   * @param onExchange 可选的 exchange 水槽（切片 2 的 Session 抓包链路）。
   *   缺省表示只走旧链路；水槽内抛错被吞掉，不影响 ProxyStore（spec §4 / R3）。
   */
  constructor(
    certsDir: string = resolveMitmCertsDir(),
    private readonly onExchange?: (exchange: CapturedExchange) => void,
  ) {
    this.store = new ProxyStore();
    this.caManager = new CaManager(certsDir);
  }

  /**
   * 单条 exchange 的落点：先旧链路（ProxyStore），再新链路（水槽）。
   * 顺序不可换 —— 新链路失败时旧链路必须已经落好（spec §4 / R3）。
   */
  recordExchange(exchange: CapturedExchange): void {
    this.store.add(exchange);
    if (!this.onExchange) return;
    try {
      this.onExchange(exchange);
    } catch (error) {
      logger.warn('[MitmModule] Session 水槽摄入失败，已忽略', error);
    }
  }
```

`start()` :56-60 的 server 回调改成：

```ts
        this.server = new MitmProxyServer(this.caManager, exchange => {
          this.recordExchange(exchange);
        });
```

> **为什么水槽不带 `fromMitmExchange`**：适配器是纯映射函数，交给 `RuntimeServices` 在接线处调（下一步），`MitmModule` 因此不依赖 `src/modules/session/**`，保持 proxy 模块的边界干净。

- [ ] **Step 4: `RuntimeServices.getMitmModule()` 接线**

```ts
  getMitmModule(): MitmModule {
    return (this.mitmModule ??= new MitmModule(resolveMitmCertsDir(), exchange => {
      this.getCaptureEngine().ingestRequest(fromMitmExchange(exchange));
    }));
  }
```

> `??=` 只在**首次**调用时构造，所以 sink 里捕获的 `this` 指向 RuntimeServices 本身是安全的；engine 走 `getCaptureEngine()` 延迟取，避免门面构造顺序问题。需补 import：`resolveMitmCertsDir`（`../modules/proxy/index.js` 已导出）与 `fromMitmExchange`（`../modules/session/adapters/index.js`）。
>
> **注意循环依赖方向**：`RuntimeServices` 已经 import `../modules/proxy/index.js` 与 `../modules/session/index.js`，新增的两条 import 不引入新的模块环。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/MitmModule.test.js build/tests/unit/runtime/RuntimeServices.test.js`
Expected: 全 PASS。`RuntimeServices.test.js` 是关键回归——它用 `:memory:` 跑真实 engine，若 sink 接线写错（例如每次调 `getCaptureEngine()` 都新建），这里会先红。

Run: `npm run typecheck && npx prettier --check src/modules/proxy/MitmModule.ts src/runtime/RuntimeServices.ts tests/unit/modules/proxy/MitmModule.test.ts && npx eslint src/modules/proxy/MitmModule.ts src/runtime/RuntimeServices.ts tests/unit/modules/proxy/MitmModule.test.ts`
Expected: 零告警。

- [ ] **Step 6: 提交**

```bash
git add src/modules/proxy/MitmModule.ts src/runtime/RuntimeServices.ts tests/unit/modules/proxy/MitmModule.test.ts
git commit -m "feat(proxy): add optional exchange sink for session capture"
```

---

### Task 5: `createSessionRoutes`（Session 抓包的 REST 出口）

**Files:**

- Create: `src/web/routes/session.ts`
- Create: `tests/integration/web/session-routes.integration.test.ts`（新目录 `tests/integration/web/`，镜像 `tests/unit/web/routes/` 的既有约定）
- Modify: `src/web/routes/proxy.ts:147-170`（`GET /api/proxy/requests` 上方补一条注释，说明 UI 将改走 Session 端点）

**Interfaces:**

- Consumes:
  - `SqliteSessionStore.listRequestSummaries(sessionId, filter, page)`（切片 1 已建，:304-355；limit/offset 已在 SQL 侧 clamp 到 `[1, LIST_MAX_LIMIT]` / `>= 0`，路由层只需做整数解析）
  - `SqliteSessionStore.getRequest(id)`（:297-302）
  - `CaptureSessionManager.getActiveSession()`（:49-53；无会话返回 `null`，**不抛**）
- Produces:
  - `createSessionRoutes(getServices: SessionServicesAccessor): Map<string, RouteHandler>`
  - `getServices: SessionServicesAccessor = () => {manager: CaptureSessionManager; store: SqliteSessionStore} | undefined`
  - `GET /api/session/requests` → `{items: SessionRequestSummaryEvent[]; total: number}`
  - `GET /api/session/requests/:id` → `SessionRequestDetail`

> **有意偏离 spec §9 的签名（写死，不要"修正"）**：spec 写的是 `createSessionRoutes(store, manager)`，即构造期把两个服务实例传进来。但 `ConsoleServer` 的 `setupRoutes()` 在**构造函数**里跑（`src/web/ConsoleServer.ts:89-93`），而它的单测 mock runtime 只有 `browserManager` / `hookManager` 两项（`tests/unit/web/ConsoleServer.test.ts`）——构造期取 `runtime.captureSessionManager` 会直接抛。所以改成注入一个**取值函数**，每个请求进来时才解一次；取不到返回 503 `SESSION_UNAVAILABLE` 而不是 500。行为等价，且在服务尚未就绪时更诚实。

> **不需要 `wsHub`**：`createProxyRoutes(mitmModule, wsHub)` 需要 hub 是因为它要在 start/stop 时推 `proxy.status`；Session 路由只读库，推流由 `CaptureEngine` 自己在摄入时做（spec §8）。照抄 proxy 的签名会把一个用不上的依赖带进来。

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/web/session-routes.integration.test.ts`（`@license` 头用 `Copyright 2026 Google LLC`，跟随 `src/web/routes/proxy.ts`）。路由层测试按既有约定放 `tests/integration/web/`，见 `tests/unit/web/routes/proxy.test.ts` 的 mock 手法（EventEmitter + `process.nextTick` + `MockRes`）：

```ts
import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {beforeEach, describe, it} from 'node:test';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
import {RestRouter} from '../../../src/web/RestRouter.js';
import {createSessionRoutes} from '../../../src/web/routes/session.js';
import type {CapturedRequestInput} from '../../../src/modules/session/types.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  setHeader(name: string, value: string): void;
  end(payload?: string): void;
  headersSent: boolean;
}

// 注意：必须是 IncomingMessage。RestRouter.dispatch(req, res, pathname) 的
// 第一参是 IncomingMessage（RestRouter.ts:63-67），纯 EventEmitter 会 TS2345。
// 用 `as unknown as` 在**函数内部**完成断言（与 tests/unit/web/routes/proxy.test.ts:34
// 同款），调用点就不必再写 `as never`。
function mockReq(method: string, url: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  req.method = method;
  req.url = url;
  process.nextTick(() => req.emit('end'));
  return req;
}

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(payload?: string) {
      this.headersSent = true;
      this.body = payload ? JSON.parse(payload) : undefined;
    },
  };
  return res as MockRes;
}

function input(overrides: Partial<CapturedRequestInput> = {}): CapturedRequestInput {
  return {
    timestamp: 1_700_000_000_000,
    method: 'GET',
    url: 'https://d.dev/api/x',
    source: 'cdp',
    requestHeaders: '{"cookie":"session=1"}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: '{"content-type":"application/json"}',
    responseBody: '{"secret":"value"}',
    contentType: 'application/json',
    initiator: null,
    durationMs: 0,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
    ...overrides,
  };
}

describe('createSessionRoutes', () => {
  let router: RestRouter;
  let manager: CaptureSessionManager;
  let store: SqliteSessionStore;
  let db: DatabaseManager;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    store = new SqliteSessionStore(db);
    manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);
    engine.ingestRequest(input());
    engine.ingestRequest(input({url: 'https://d.dev/api/y', method: 'POST'}));
    engine.ingestRequest(
      input({
        source: 'proxy',
        url: 'https://d.dev/api/z',
        responseHeaders: '{not-json',
      }),
    );
    router = new RestRouter();
    router.mount(createSessionRoutes(() => ({manager, store})));
  });

  it('returns summaries without any body field', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as {success: boolean; data: {items: unknown[]; total: number}};
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.total, 3);
    assert.strictEqual(body.data.items.length, 3);
    for (const item of body.data.items as Record<string, unknown>[]) {
      assert.strictEqual(
        'responseBody' in item,
        false,
        'spec §8 / R1：摘要不含 body',
      );
      assert.strictEqual('requestHeaders' in item, false);
    }
    // spec §9：SQL 按 sequence DESC 取，响应内反转成时间正序。
    // 此处 limit 缺省（500）>= total（3），所以整窗返回、items[0] 确实最旧。
    // 带 limit 时 items[0] 是窗口内最新（见 Step 3 「反转」注释）。
    const urls = (body.data.items as {url: string}[]).map(i => i.url);
    assert.deepStrictEqual(urls, [
      'https://d.dev/api/x',
      'https://d.dev/api/y',
      'https://d.dev/api/z',
    ]);
  });

  it('filters by sources', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?sources=proxy'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    const body = res.body as {data: {items: {source: string}[]; total: number}};
    assert.strictEqual(body.data.total, 1);
    assert.strictEqual(body.data.items[0]!.source, 'proxy');
  });

  it('clamps limit and offset without 500', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?limit=99999&offset=-5'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as {data: {items: unknown[]}};
    assert.strictEqual(body.data.items.length, 3);
  });

  it('returns 400 for a non-numeric limit', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?limit=abc'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 400);
  });

  it('returns the detail with headers as objects', async () => {
    // 注意：SQL 先 DESC 再 LIMIT，limit=1 取到的是 cdp 里**最新**的一条 = api/y
    //（不是最旧的 api/x）。显式断言 url，把这个隐含假设钉死——否则三条 fixture
    // 的 body 恰好相同时，取错行也能蒙混过关。
    const listRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?sources=cdp&limit=1'),
      listRes as unknown as ServerResponse,
      '/api/session/requests',
    );
    const {items} = (listRes.body as {
      data: {items: {id: string; url: string}[]};
    }).data;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]!.url, 'https://d.dev/api/y', 'DESC + LIMIT 1');
    const id = items[0]!.id;

    const res = mockRes();
    await router.dispatch(
      mockReq('GET', `/api/session/requests/${id}`),
      res as unknown as ServerResponse,
      `/api/session/requests/${id}`,
    );

    assert.strictEqual(res.statusCode, 200);
    const detail = (res.body as {data: Record<string, unknown>}).data;
    assert.strictEqual(detail['responseBody'], '{"secret":"value"}');
    assert.deepStrictEqual(detail['responseHeaders'], {
      'content-type': 'application/json',
    });
    assert.strictEqual(detail['headersParseError'], undefined);
  });

  it('degrades dirty header JSON to {} with headersParseError', async () => {
    const listRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?sources=proxy'),
      listRes as unknown as ServerResponse,
      '/api/session/requests',
    );
    const {items} = (listRes.body as {
      data: {items: {id: string; url: string}[]};
    }).data;
    assert.strictEqual(items[0]!.url, 'https://d.dev/api/z');

    const res = mockRes();
    await router.dispatch(
      mockReq('GET', `/api/session/requests/${items[0]!.id}`),
      res as unknown as ServerResponse,
      `/api/session/requests/${items[0]!.id}`,
    );

    assert.strictEqual(res.statusCode, 200);
    const detail = (res.body as {data: Record<string, unknown>}).data;
    assert.deepStrictEqual(detail['responseHeaders'], {});
    assert.strictEqual(detail['headersParseError'], true);
  });

  it('returns 404 for an unknown id', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests/does-not-exist'),
      res as unknown as ServerResponse,
      '/api/session/requests/does-not-exist',
    );

    assert.strictEqual(res.statusCode, 404);
  });

  it('returns 503 when session services are unavailable', async () => {
    const bare = new RestRouter();
    bare.mount(createSessionRoutes(() => undefined));
    const res = mockRes();
    await bare.dispatch(
      mockReq('GET', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 503);
    const body = res.body as {error: {code: string}};
    assert.strictEqual(body.error.code, 'SESSION_UNAVAILABLE');
  });

  it('returns 503 with no active session instead of throwing', async () => {
    const freshDb = new DatabaseManager(':memory:');
    const freshStore = new SqliteSessionStore(freshDb);
    const freshManager = new CaptureSessionManager(freshStore);
    const bare = new RestRouter();
    bare.mount(createSessionRoutes(() => ({manager: freshManager, store: freshStore})));

    const res = mockRes();
    await bare.dispatch(
      mockReq('GET', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(
      res.statusCode,
      503,
      'spec §13-D7：查询不得创建会话；无活动会话是 503 不是 500',
    );
    freshDb.close();
  });
});
```

> **dispatch 必须传三个参数**（B2）：`RestRouter.dispatch(req, res, pathname)`（`src/web/RestRouter.ts:63-67`），`pathname` **没有默认值**。第三个参数要传**已剥离 query 的 path**——`ConsoleServer` 生产路径就是这么做的（`:192` 剥 query，`:209` 再传）。传完整的 `'/api/session/requests?sources=proxy'` 会让路由正则 `^/api/session/requests/?$` 匹配不上，dispatch 静默返回 `false`，表现为 `statusCode` 停在 0、`body` 是 `undefined`——不是清晰的 404，排查会很费劲。
>
> `mkdtempSync` / `os` / `path` 在本文件里用不到，别为"对齐 proxy.test.ts 风格"硬凑 import —— `noUnusedLocals` 在根 tsconfig 里是关的，但 ESLint 会报未使用导入。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 报 `ERR_MODULE_NOT_FOUND ... build/src/web/routes/session.js`。RED。

- [ ] **Step 3: 实现 `createSessionRoutes`**

创建 `src/web/routes/session.ts`（`@license` 用 `Copyright 2026 Google LLC`）。`RouteHandler` / `sendError` / `sendJson` / `sendUnexpected` 与 `src/web/routes/proxy.ts:17-21` 同款：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {CaptureSessionManager} from '../../modules/session/CaptureSessionManager.js';
import type {SessionStore} from '../../modules/session/SessionStore.js';
import type {CaptureSource} from '../../modules/session/types.js';
import type {SessionRequestDetail} from '../types.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

export interface SessionServices {
  manager: CaptureSessionManager;
  // 用接口而不是 SqliteSessionStore 具体实现：Task 6 的喂入端是
  // CaptureEngine.getStore(): SessionStore（private store 的类型），
  // 收窄成实现类会 TS2739（SessionStore 缺 manager / db 两个私有字段）。
  // 路由只用到 listRequestSummaries / getRequests / getRequest —— 三者都在
  // SessionStore 接口上（SessionStore.ts:31/29/35），放宽后行为零变化。
  store: SessionStore;
}

/**
 * 每次请求进来时现取服务；取不到返回 503。
 *
 * 不用构造期注入：ConsoleServer 的 setupRoutes() 跑在构造函数里，
 * 而 runtime 服务可能尚未就绪（spec §7 / D6）。
 */
export type SessionServicesAccessor = () => SessionServices | undefined;

const SOURCES: CaptureSource[] = ['cdp', 'proxy'];

const parseHeaders = (
  raw: string | null,
): {headers: Record<string, string>; parseError?: true} => {
  if (!raw) return {headers: {}};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {headers: {}, parseError: true};
    }
    return {headers: parsed as Record<string, string>};
  } catch {
    return {headers: {}, parseError: true};
  }
};

/** 整数解析：非法值返回 undefined，交给调用方决定 400 还是忽略。 */
function parseIntParam(
  raw: string | null,
  onInvalid: () => void,
): number | undefined {
  if (raw === null || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    onInvalid();
    return undefined;
  }
  return value;
}

export function createSessionRoutes(
  getServices: SessionServicesAccessor,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/session/requests',
      (_req, res) => {
        const services = getServices();
        const session = services?.manager.getActiveSession();
        if (!services || !session) {
          sendError(res, 'SESSION_UNAVAILABLE', '暂无活动抓包会话', 503);
          return;
        }

        try {
          const url = new URL(_req.url ?? '/', 'http://127.0.0.1');
          const sourcesRaw = url.searchParams.get('sources');
          const sources = sourcesRaw
            ? (sourcesRaw
                .split(',')
                .map(s => s.trim())
                .filter((s): s is CaptureSource =>
                  (SOURCES as string[]).includes(s),
                ) as CaptureSource[])
            : undefined;

          let badRequest = false;
          const limit = parseIntParam(url.searchParams.get('limit'), () => {
            badRequest = true;
          });
          const offset = parseIntParam(url.searchParams.get('offset'), () => {
            badRequest = true;
          });
          if (badRequest) {
            sendError(res, 'BAD_REQUEST', 'limit / offset 必须是整数', 400);
            return;
          }

          const urlFilter = url.searchParams.get('urlFilter');
          const filter = {
            ...(sources && sources.length > 0 ? {sources} : {}),
            ...(urlFilter ? {urlFilter} : {}),
          };

          const items = services.store.listRequestSummaries(
            session.id,
            filter,
            {limit, offset},
          );

          // total 与本次分页无关（不受 limit/offset 影响），但跟随同一份 filter：
          // 过滤后 total 与 items 的口径必须一致，否则前端分页器会算出不存在的页数。
          const total = services.store.getRequests(session.id, filter).length;
          // 库里按 sequence DESC 取最近 N 条（首屏只拉摘要），响应内反转成时间正序
          // 交出去（spec §9）。[...items] 而非 items.reverse()——不改动 store 返回的数组。
          //
          // 「反转」只保证**窗口内**时间正序：SQL 是「先 ORDER BY sequence DESC，
          // 再 LIMIT/OFFSET」（SqliteSessionStore.ts:335-336）。所以 limit=1 拿到的是
          // **最新**一条，不是最旧一条；翻页方向是「从最新往回」，第 2 页每一行都比
          // 第 1 页旧。前端分页器必须按这个方向实现，不要照下面「items[0] 最旧」的
          // 直觉写——那条直觉只在 limit >= total 时成立。
          sendJson(res, {items: [...items].reverse(), total});
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/session/requests/:id',
      (_req, res, params) => {
        const id = params?.id;
        if (!id) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const services = getServices();
        if (!services) {
          sendError(res, 'SESSION_UNAVAILABLE', '暂无活动抓包会话', 503);
          return;
        }
        try {
          const row = services.store.getRequest(id);
          if (!row) {
            sendError(res, 'NOT_FOUND', `未找到请求 ${id}`, 404);
            return;
          }
          const request = parseHeaders(row.requestHeaders);
          const response = parseHeaders(row.responseHeaders);
          const parseError = request.parseError || response.parseError;

          const detail: SessionRequestDetail = {
            ...row,
            requestHeaders: request.headers,
            responseHeaders: response.headers,
            ...(parseError ? {headersParseError: true} : {}),
          };
          sendJson(res, detail);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
  ]);
}
```

> `total` 用 `getRequests(session.id, filter).length` 是**同一 filter 下的全量计数**：不受 limit/offset 影响，但跟随 sources/urlFilter（否则前端分页器会算出不存在的页数）。代价是一次全量取行——会话行数上限 `DEFAULT_SESSION_KEEP = 5000`（`src/modules/session/constants.ts`），配额 trim 之后这个量级可接受，故此处记为已知天花板。**不要**现在就加 `countRequests` 到 `SessionStore` 接口：那是高扇入接口（spec §7 约束 2），本切片不该动它。真到了要动的那天，在 `SqliteSessionStore` 里用 `SELECT COUNT(*)` 实现，并在接口上加一个可选方法，既有实现零改动。

- [ ] **Step 4: 补 `proxy.ts` 的并存注释**

在 `src/web/routes/proxy.ts` 的 `'GET /api/proxy/requests',`（:148）上方加一行注释，**不要改任何代码**：

```ts
    // 旧链路（MITM-only 调试端点）：切片 3 之前 UI 仍读这里，请勿删除。
    // 新链路见 GET /api/session/requests（createSessionRoutes）。
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/integration/web/session-routes.integration.test.js`
Expected: 9 个用例全 PASS。

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/routes/proxy.test.js`
Expected: 全 PASS（旧链路未受影响）。

Run: `npm run typecheck && npm run web:typecheck`
Expected: 双通过。若 `web:typecheck` 报错，说明 `SessionRequestDetail` 与 `CapturedRequestRow` 的字段对不齐——先修 `src/web/types.ts` 里的定义，不要动 `CapturedRequestRow`。

> 对齐的依据（照抄即可，不要凭记忆改字段顺序）：`CapturedRequestRow`（`src/modules/session/types.ts:39-58`）的字段依次是
> `id / sessionId / sequence / timestamp / method / url / source / requestHeaders / requestBody / statusCode / responseHeaders / responseBody / contentType / initiator / durationMs / isStreaming / isWebSocket / truncated`。
> `SessionRequestDetail` 用 `...row` 摊开整行，再把 `requestHeaders` / `responseHeaders` 从 `string` 覆盖成 `Record<string, string>`——所以它的字段顺序故意与 row 不同（把 `statusCode`/`contentType`/`source` 提到 headers 之前），读起来更像一个 API 响应体。摊开 + 覆盖的顺序**不能反**，否则 `string` 会把 `Record` 覆盖回去。

Run: `npx prettier --check src/web/routes/session.ts src/web/routes/proxy.ts tests/integration/web/session-routes.integration.test.ts && npx eslint src/web/routes/session.ts src/web/routes/proxy.ts tests/integration/web/session-routes.integration.test.ts`
Expected: 零告警。

- [ ] **Step 6: 提交**

```bash
git add src/web/routes/session.ts src/web/routes/proxy.ts tests/integration/web/session-routes.integration.test.ts
git commit -m "feat(web): add session request list and detail routes"
```

---

### Task 6: `ConsoleServer` 桥接与路由挂载

**Files:**

- Modify: `src/web/ConsoleServer.ts`
  - imports :14 区块补 `logger`（`../utils/logger.js`）
  - imports :33 之后补 `createSessionRoutes`（`./routes/session.js`）
  - `setupRoutes()` :165-167 之后挂载 Session 路由
  - `start()` :306-319 的 proxy 监听**之后**追加 `setEmitToWs` 桥接
  - `stop()` :348-352 的 proxy 解绑**之后**追加 `setEmitToWs(undefined)`
- Modify: `src/web/routes/proxy.ts`（无，见 Task 5 Step 4）

**Interfaces:**

- Consumes:
  - `Runtime.captureEngine?`（`src/runtime.ts:70`，可选）
  - `Runtime.captureSessionManager`（非可选，:65）+ `CaptureEngine` 持有的 store
  - `CaptureEngine.setEmitToWs(fn?)`（:59-63）
  - `WsHub.getSubscriberCount(channel)`（:196-207）
- Produces: `start()` 里晚绑定桥接；`stop()` 里解绑；Session 路由可访问

> **为什么桥接必须在 `start()` 而不是构造函数**：`CaptureEngine` 的 `emitToWs` 是晚绑定设计（spec §8）——runtime 在 `ConsoleServer` 之前就建立了，构造期 engine 可能还没被 lazy getter 创建。在 `start()` 注入、在 `stop()` 传 `undefined` 解绑，是这条约束的直接落地。

> **为什么 `getSubscriberCount(...) === 0` 要短路**：`WsHub.broadcast`（`src/web/ws/WsHub.ts:124-153`）在 :137 就 `JSON.stringify` 了 payload，**在**遍历连接之前。没有订阅者时零短路能省掉每条请求一次的序列化开销——抓包高峰下这是实打实的成本。

> **红线（并存）**：`onProxyCaptureListener` 的注册（:306-319）与解绑（:348-352）**一字不动**。切片 3 才下线它。本 Task 只在其后**追加**代码。

- [ ] **Step 1: 确认当前未挂载（RED 观测点）**

`RestRouter.dispatch()`（`src/web/RestRouter.ts:63-88`）未命中时**只返回 false、不发任何响应**——所以「路由没挂」的表现是 `res.headersSent === false` 且 `body === undefined`，**不是 404**。404 是 `ConsoleServer` 在 dispatch 返回 false 之后发的（:250-262）。

> **本 Task 不写这个观测点，验收交给 Task 7。** 已核实 `tests/unit/web/ConsoleServer.test.ts`（全文件 118 行）**没有** `router` / `mockRes` / `mockReq` 三个助手中的任何一个——它走的是 `node:http` 的 `request()` 打真实端口（`:74-97`）。要造这套助手就得连同 `mockReq` 的类型断言一起新写一遍，成本高于收益。
>
> 如果你仍想加这个观测点，正确写法是三参（同 Task 5 的 B2）：
>
> ```ts
> const handled = await router.dispatch(
>   mockReq('GET', '/api/session/requests'), // 必须返回 IncomingMessage
>   res as unknown as ServerResponse,
>   '/api/session/requests', // 已剥离 query 的 pathname，无默认值
> );
> assert.strictEqual(handled, true, 'Session 路由必须已挂载');
> ```

- [ ] **Step 2: 确认当前未挂载（红）—— 本 Task 跳过，见 Step 1 说明**

- [ ] **Step 3: 补 import**

`src/web/ConsoleServer.ts` —— 在**父级组**里插入 `logger`。注意 `import/order` 配了
`alphabetize: {order: 'asc', caseInsensitive: true}`（`eslint.config.mjs:126-136`），
父级组的正确顺序是 `../runtime.js` → `../tools/tools-meta.js` → **`../utils/logger.js`** →
`../worker/JobStore.js`。所以 `logger` 要插在 `../tools/tools-meta.js`（:15-20）**之后**、
`../worker/JobStore.js`（:21）**之前**，不是紧跟 `../runtime.js`：

```ts
import {getAllToolNames /* ... */} from '../tools/tools-meta.js';
import {logger} from '../utils/logger.js';
import {JobStore} from '../worker/JobStore.js';
```

同级组里，在 :33 的 `import {createProxyRoutes} from './routes/proxy.js';` 之后加：

```ts
import {createSessionRoutes} from './routes/session.js';
```

- [ ] **Step 4: 挂载 Session 路由**

`setupRoutes()` 里、`createProxyRoutes(...)` 的 `this.router.mount(...)`（:165-167）之后追加：

```ts
    this.router.mount(
      createSessionRoutes(() => {
        const engine = this.options.runtime.captureEngine;
        const manager = this.options.runtime.captureSessionManager;
        if (!engine || !manager) return undefined;
        return {manager, store: engine.getStore()};
      }),
    );
```

> `engine.getStore()` 目前不存在——`CaptureEngine` 的 store 是 private（`src/modules/session/CaptureEngine.ts:46`）。两个选项：
> 1. **给 `CaptureEngine` 加一个 `getStore(): SessionStore` getter**（最小改动，一个方法，无行为变化，不影响任何既有调用方）。
> 2. 让 `createSessionRoutes` 改为接收 manager + store 两个取值函数。
>
> **选 1**，理由：store 引用只读、不暴露写路径，且 `RuntimeServices` 已经保证 manager 与 engine 共享同一个 store 实例（`ensureSessionStore()` 单例，spec §7 约束 3）。**不要**让 `ConsoleServer` 自己 new 一个 `SqliteSessionStore` —— 那会开出第二个数据库句柄。
>
> `getStore()` 的返回类型**必须是 `SessionStore` 接口**（`CaptureEngine` 的 `store` 字段本身就是这个类型）。Task 5 Step 3 已据此把 `SessionServices.store` 声明为 `SessionStore` 而非 `SqliteSessionStore`——若两边任一侧写成实现类，相接处会报 TS2739（`SessionStore` 缺 `manager` / `db` 两个私有字段）。本切片的实测：`tsc --noEmit` 对 `store: SqliteSessionStore = getStore(): SessionStore` 直接报 `error TS2739`。
>
> **两个 `if` 一个都不能省**：`Runtime.captureEngine` 是可选（`src/runtime.ts:70`），测试用的 mock runtime 两项都没有。注意 `captureSessionManager` 在 `Runtime` 上是**非可选**（:65）——所以 `!manager` 守卫防的是"类型说有、mock 里没有"的现实，不是防类型。两个守卫都写成 `if (!engine || !manager)` 一行，不要拆。

- [ ] **Step 5: `start()` 里晚绑定桥接**

`start()` 的 proxy 监听块（:306-319）之后追加：

```ts
    // Session 抓包摘要桥接（spec §8）。
    // 白名单之外的 type（session.hook / session.snapshot）显式记日志 ——
    // 它们来自 engine 的 ingestHook/ingestSnapshot，切片 2 不注册这两个频道，
    // 静默丢弃要显式化，否则"忘了注册"和"没数据"看起来一模一样。
    //
    // 用 warn 而非 debug：logger 的默认级别是 info（src/utils/logger.ts:289），
    // debug() 会被 shouldLog()（:151-153）短路成空操作，除非显式设 LOG_LEVEL=debug
    // ——那正是"静默"本身，与 spec §8 的意图相反。ingestHook/ingestSnapshot 当前
    // 无人调用，用 warn 不会刷屏；等它们真的接上、日志变吵时再降回 debug。
    this.options.runtime.captureEngine?.setEmitToWs(event => {
      if (event.type !== 'session.request') {
        logger.warn(
          `[ConsoleServer] 忽略未注册的 session 事件: ${event.type}`,
        );
        return;
      }
      if (this.wsHub.getSubscriberCount('session.request') === 0) return;
      this.wsHub.broadcast('session.request', event.payload);
    });
```

- [ ] **Step 6: `stop()` 里解绑**

`stop()` 的 proxy 解绑块（:348-352）之后追加：

```ts
    this.options.runtime.captureEngine?.setEmitToWs(undefined);
```

> 注意顺序：`stop()` 第 2 步就会关 WS 服务，所以解绑必须放在**第 1 步的桥接清理区块**里，与 `onProxyCaptureListener` 并列。

- [ ] **Step 7: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ConsoleServer.test.js`
Expected: 全 PASS。**这条是本 Task 的核心回归**：mock runtime 没有 `captureEngine` 也没有 `captureSessionManager`，若 `?.` 漏了或路由在构造期强取服务，这里会立刻红。

Run: `npm run typecheck && npx prettier --check src/web/ConsoleServer.ts && npx eslint src/web/ConsoleServer.ts`
Expected: 零告警。

- [ ] **Step 8: 提交**

```bash
git add src/web/ConsoleServer.ts src/modules/session/CaptureEngine.ts
git commit -m "feat(web): bridge session.request to WsHub and mount session routes"
```

> `CaptureEngine.ts` 若因 Step 4 的 `getStore()` 而改动，一并提交；未改则只提交 `ConsoleServer.ts`。提交前 `git status --porcelain` 核对。

---

### Task 7: `ConsoleServer` 桥接回归（spec §11 矩阵行）

**Files:**

- Modify: `tests/unit/web/ConsoleServer.test.ts`（拆成两个 describe：原 mock runtime 不变 + 新增带 engine 的桥接组）

**Interfaces:**

- Consumes: `ConsoleServer.start()` / `stop()`、`(server as any).wsHub`（本文件 :64 已在用这个既有手法访问私有成员）
- Produces: 三条断言——缺 `captureEngine` 时不抛、有 engine 时推摘要、零订阅者不推

> **为什么用 `(server as any).wsHub` 而不是新增 getter**：`ConsoleServer` 的 `wsHub` 是 private（:78），本测试文件 :64 已经用 `(server as any).httpServer` 拿私有 HTTP server。沿用同一手法，不为测试在生产类上加一个只为测试存在的 getter。

- [ ] **Step 1: 补桥接组测试**

在 `tests/unit/web/ConsoleServer.test.ts` 末尾、最外层 `describe` 之内追加（需补 import：`DatabaseManager`、`CaptureEngine`、`CaptureSessionManager`、`SqliteSessionStore`、`WsHub`、`CapturedRequestInput` 类型；顺序交 `npx eslint --fix`）：

```ts
  it('starts and stops without a capture engine', async () => {
    // mockRuntime 没有 captureEngine / captureSessionManager / mitmModule。
    // 本文件顶层的 before()/after() 已经跑过一轮 start()/stop()，
    // 这里再显式跑一次，把「缺失服务不抛」变成一条会红的断言而不是隐含前提。
    const bare = new ConsoleServer({
      port: 0,
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: mockRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await assert.doesNotReject(async () => {
      await bare.start();
      await bare.stop();
    });
  });

  it('bridges session.request summaries to WsHub subscribers', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const capturingRuntime = {
      ...mockRuntime,
      captureSessionManager: manager,
      captureEngine: engine,
    } as unknown as Runtime;

    const srv = new ConsoleServer({
      port: 0,
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: capturingRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await srv.start();
    try {
      const hub = (srv as any).wsHub as WsHub;
      const ws = {
        readyState: 1,
        sent: [] as Record<string, any>[],
        send(data: string) {
          this.sent.push(JSON.parse(data));
        },
        close() {
          this.readyState = 3;
        },
      };
      hub.subscribe(ws as never, 'session.request');

      engine.ingestRequest(bridgeInput());

      assert.strictEqual(ws.sent.length, 1);
      const evt = ws.sent[0]!;
      assert.strictEqual(evt['channel'], 'session.request');
      assert.strictEqual(evt['type'], 'event');
      const payload = evt['payload'] as Record<string, unknown>;
      assert.strictEqual(payload['url'], 'https://e.dev/api/sign');
      assert.strictEqual(payload['source'], 'cdp');
      assert.strictEqual(
        'responseBody' in payload,
        false,
        'spec §8 / R1：WS 只推摘要',
      );
    } finally {
      await srv.stop();
      db.close();
    }
  });

  it('skips the broadcast when nobody subscribed', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const capturingRuntime = {
      ...mockRuntime,
      captureSessionManager: manager,
      captureEngine: engine,
    } as unknown as Runtime;

    const srv = new ConsoleServer({
      port: 0,
      group: 'test-group',
      rpcHost: 'test-host',
      runtime: capturingRuntime,
      invoker: mockInvoker,
      toolAdapter: mockToolAdapter,
    });
    await srv.start();
    try {
      const hub = (srv as any).wsHub as WsHub;
      assert.strictEqual(hub.getSubscriberCount('session.request'), 0);
      // 零订阅者短路：不抛、不序列化、不产生副作用
      assert.doesNotThrow(() => engine.ingestRequest(bridgeInput()));

      const session = manager.getActiveSession();
      assert.ok(session, '短路只影响推送，落库照常');
      assert.strictEqual(manager.getRequests(session.id).length, 1);
    } finally {
      await srv.stop();
      db.close();
    }
  });
```

并在 `describe('ConsoleServer', ...)` 之前加 fixture：

```ts
function bridgeInput(): CapturedRequestInput {
  return {
    timestamp: 1_700_000_000_000,
    method: 'POST',
    url: 'https://e.dev/api/sign',
    source: 'cdp',
    requestHeaders: '{}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: '{"content-type":"application/json"}',
    responseBody: '{"sign":"abc"}',
    contentType: 'application/json',
    initiator: null,
    durationMs: 0,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
  };
}
```

> `hub.subscribe(ws as never, 'session.request')` 里的 `as never`：`MinimalWebSocket`（`src/web/ws/WsHub.ts:36-39`）只声明 `readyState` / `send`，我们的 mock 多了 `sent` / `close()`，结构上可赋值；若类型仍不通，`as never` 是该文件既有风格（`tests/unit/web/ws/WsHub.test.ts` 已用），接受它。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ConsoleServer.test.js`
Expected: 第 2 个用例失败（`ws.sent.length === 0`，桥接还没写）；第 1、3 个当前通过（护栏）。

- [ ] **Step 3: 跑测试确认通过（Task 6 已完成实现）**

Run: 同上
Expected: 2 + 2 = 4 个用例全 PASS。若第 1 个（桥接）仍红，回 Task 6 检查 `setEmitToWs` 是否真的在 `start()` 里被调用（常见错误：写在了 `setupRoutes()` 里，那时 engine 还没注入）。

Run: `npm run typecheck && npx prettier --check tests/unit/web/ConsoleServer.test.ts && npx eslint tests/unit/web/ConsoleServer.test.ts`
Expected: 零告警。

- [ ] **Step 4: 提交**

```bash
git add tests/unit/web/ConsoleServer.test.ts
git commit -m "test(web): cover session.request bridge and missing-engine startup"
```

---

### Task 8: 双链路端到端集成（spec §14 验收门槛）

**Files:**

- Create: `tests/integration/session/capture-wiring.integration.test.ts`（与既有的 `session-ai-pipeline.integration.test.ts` 同目录，复用它的 `makeRuntime()` 手法）

**Interfaces:**

- Consumes: `SessionCaptureBridge`（Task 2）、`MitmModule.recordExchange` + sink（Task 4）、`fromMitmExchange`、`SqliteSessionStore.listRequestSummaries`
- Produces: 一条断言链——CDP 与 MITM 落在**同一个**会话里，且 `sources` 过滤能分别取出

> 这是切片 2 的验收核心（spec §14：「集成测试 + 手工一次导航，`captured_requests` 有行」）。前七个 Task 各自单测通过不代表两条链路汇合后还正确——共享 store、共享 session、sequence 递增、配额 trim，全在这里交汇。

- [ ] **Step 1: 写测试**

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import type {BrowserContext, Response} from 'patchright';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {fromMitmExchange} from '../../../src/modules/session/adapters/index.js';
import {MitmModule} from '../../../src/modules/proxy/MitmModule.js';
import type {CapturedExchange} from '../../../src/modules/proxy/types.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
import {SessionCaptureBridge} from '../../../src/worker/context/SessionCaptureBridge.js';

function cdpResponse(url: string): Response {
  return {
    status: () => 200,
    headers: () => ({'content-type': 'application/json'}),
    request: () => ({
      method: () => 'GET',
      url: () => url,
      headers: () => ({}),
      postData: () => null,
    }),
    text: async () => '{"ok":true}',
  } as unknown as Response;
}

function exchange(url: string): CapturedExchange {
  return {
    requestId: 'r1',
    method: 'GET',
    url,
    requestHeaders: {},
    requestBody: null,
    statusCode: 200,
    responseHeaders: {},
    responseBody: '{"ok":true}',
    contentType: 'application/json',
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: Date.now(),
  };
}

const flush = (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve));

describe('切片 2 双链路接线', () => {
  it('lands CDP and MITM captures in one shared session', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    // CDP 链路
    const listeners = new Set<(response: Response) => void>();
    const context = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') listeners.add(handler);
        return context;
      },
      off: (_event: string, handler: (response: Response) => void) => {
        listeners.delete(handler);
        return context;
      },
    } as unknown as BrowserContext;
    const bridge = new SessionCaptureBridge(() => engine);
    bridge.attach(context);

    // MITM 链路
    const certsDir = mkdtempSync(path.join(os.tmpdir(), 'capture-wiring-'));
    const mitm = new MitmModule(certsDir, ex => {
      engine.ingestRequest(fromMitmExchange(ex));
    });

    try {
      for (const listener of [...listeners]) {
        listener(cdpResponse('https://f.dev/api/cdp'));
      }
      await flush();
      mitm.recordExchange(exchange('https://f.dev/api/mitm'));
      await flush();

      const session = manager.getActiveSession();
      assert.ok(session, '两条链路必须共享同一个自动创建的会话');

      const all = manager.getRequests(session.id);
      assert.strictEqual(all.length, 2, 'CDP 与 MITM 各一行，不得重复落库');
      assert.deepStrictEqual(
        all.map(r => r.sequence).sort((a, b) => a - b),
        [1, 2],
        'sequence 由 manager 单调递增，两条链路共用计数器',
      );

      const cdpOnly = store.listRequestSummaries(session.id, {
        sources: ['cdp'],
      });
      assert.strictEqual(cdpOnly.length, 1);
      assert.strictEqual(cdpOnly[0]!.url, 'https://f.dev/api/cdp');

      const proxyOnly = store.listRequestSummaries(session.id, {
        sources: ['proxy'],
      });
      assert.strictEqual(proxyOnly.length, 1);
      assert.strictEqual(proxyOnly[0]!.url, 'https://f.dev/api/mitm');

      // 旧链路仍在（并存红线）
      assert.strictEqual(mitm.getStore().size(), 1);

      assert.strictEqual(engine.getFailureCount(), 0);
      assert.strictEqual(bridge.getDroppedCount(), 0);
    } finally {
      bridge.detach();
      rmSync(certsDir, {recursive: true, force: true});
      db.close();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/integration/session/capture-wiring.integration.test.js`
Expected: PASS。若 `all.length === 4`，说明 MITM 走了旧 `ProxyStore.add` **和**新水槽两次之外还被别的路径重复摄入——先查 `MitmModule.recordExchange` 是否被调用了两次（Task 4 的 `start()` 回调改动是最可能的元凶）。

Run: `npx prettier --check tests/integration/session/capture-wiring.integration.test.ts && npx eslint tests/integration/session/capture-wiring.integration.test.ts`
Expected: 零告警。

- [ ] **Step 3: 提交**

```bash
git add tests/integration/session/capture-wiring.integration.test.ts
git commit -m "test(session): cover CDP and MITM capture wiring end to end"
```

---

### Task 9: 切片 2 收尾验证

**Files:**
- 只读：本切片全部改动文件

> **这一步不写生产代码。** 它只做两件事：(1) 确认改动范围没有越界；(2) 用与 Task 0 同一条命令跑一遍全量单测，逐行对比。

- [ ] **Step 1: 范围核对**

Run: `git log --oneline -15`，找到**切片 1 最后一个 commit 的短 SHA**（形如 `test(session): ...` 的地基收尾），记它为 `<base>`，然后：

```bash
git diff --name-only <base>..HEAD
```

Expected: 恰好下列文件。用 SHA 而不是 `HEAD~8` 是因为中途若为了修回归多提交了 commit，固定条数会错位、把切片 1 的 commit 也圈进来；按 SHA 是幂等的，重跑多少次结果都一样。（`HEAD~8` 只在确认期间没有额外 commit 时才等价于它。）

```
src/web/types.ts
src/web/ws/WsHub.ts
src/web/ConsoleServer.ts
src/web/routes/session.ts          （新建）
src/web/routes/proxy.ts            （仅注释）
src/worker/context/SessionCaptureBridge.ts        （新建）
src/worker/context/CollectorContextProvider.ts
src/worker/ToolContext.ts
src/modules/proxy/MitmModule.ts
src/modules/session/CaptureEngine.ts               （仅新增 getStore()）
src/runtime/RuntimeServices.ts
tests/unit/web/ws/WsHub.test.ts
tests/unit/web/ConsoleServer.test.ts
tests/unit/worker/context/SessionCaptureBridge.test.ts   （新建）
tests/unit/worker/CollectorContextProvider.test.ts
tests/unit/modules/proxy/MitmModule.test.ts
tests/integration/web/session-routes.integration.test.ts （新建）
tests/integration/session/capture-wiring.integration.test.ts（新建）
```

若发现越界文件：`git diff <base>..HEAD -- <越界文件>` 看清楚是手滑还是误改，回退不属于本切片的部分再继续。**不要**在这一步新增 commit 去"顺手修"无关文件（见 CLAUDE.md §3 Surgical Changes）。

- [ ] **Step 2: 全量单测对比基线**

必须**与 Task 0 Step 1 逐字同一条命令**，否则数字不可比。Task 0 用的是：

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
npm run test:unit 2>&1 | Tee-Object .slice2_unit.txt | Select-String '^# (tests|pass|fail)'
(Select-String -Path .slice2_unit.txt -Pattern '^not ok ').Line
Remove-Item .slice2_unit.txt
```

（`npm run test:unit` = `npm run build && node --require ./build/tests/setup.js ... --test build/tests/unit/**/*.test.js`，见 `package.json:27`。Task 0 若用了别的写法，以 Task 0 记录的为准。）

Expected: `pass` 与 `fail` 两行与 Task 0 记录的基线**逐字比对**：

- `fail` 数字**不得上升**——基线 57 个既有失败，本切片结束后仍应 ≤ 57。新失败即为回归，必须定位到 Task 1–8 中引入它的那一个并修掉。
- `pass` 数字应比基线**上升 16**，不是 20。拆法见下。

> **口径澄清（重要）**：`test:unit` 的 glob 是 `build/tests/unit/**/*.test.js`（`package.json:27`），**只覆盖 `tests/unit/`**。切片 2 的 26 个新用例分属两个不相交的集合：
>
> | 集合 | 用例 | 归属 Task | 是否被 `test:unit` 统计 |
> | :--- | :--- | :--- | :--- |
> | `tests/unit/**` | 2 + 6 + 2 + 3 + 3 = **16** | Task 1/2/3/4/7 | ✅ 计入基线 |
> | `tests/integration/**` | 9 + 1 = **10** | Task 5 / Task 8 | ❌ **不计入** |
>
> 所以本切片的正确口径是：`test:unit` 的 `pass` **+16**；另外 10 个用例只能靠下面的逐文件命令验证（它们不在 `npm run test:unit` 里，`npm run test:integration` 在本机跑不动——见 spec §11 门禁现状）。**不要**拿 26 去比 `test:unit` 的差值，也不要因为差值不是 20 就判定漏做了用例。

> **本切片新建/修改的 7 个测试文件必须全绿**（这是硬指标，与全量 fail 数无关）：

Run 七条（可分次）：

```bash
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ws/WsHub.test.js
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ConsoleServer.test.js
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/context/SessionCaptureBridge.test.js
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/worker/CollectorContextProvider.test.js
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/MitmModule.test.js
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/integration/web/session-routes.integration.test.js
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/integration/session/capture-wiring.integration.test.js
```

Expected: 全部 `fail 0`。

- [ ] **Step 3: 文件级格式与 lint 门禁**

Run（对 Step 1 列出的每个改动文件，逐个替换 `<file>`）：

```bash
npx prettier --check <file>
npx eslint <file>
npm run typecheck
```

Expected: prettier 零告警；eslint 零 error（本切片新建文件不应有 warning）；`npm run typecheck` 零 error。

**不要用 `npm run check-format` 当门禁** —— `eslint --cache .` 会在 `open-source/**` 上 OOM，`prettier --check .` 有 402 个既有 warn，两者都会给出与本切片无关的红。

- [ ] **Step 4: 前端类型门禁（只在动了 `src/web/types.ts` 时才需要——本切片动了）**

Run: `npm run web:typecheck`

Expected: 零 error。

> 原因：`src/web-ui/src/lib/protocol.ts:13` 是 `export * from '../../../web/types.js';`，Task 1 新增的 `SessionRequestSummaryEvent` / `SessionRequestDetail` 会自动流到前端；而 `src/web-ui/tsconfig.json` 是 `strict: true` + `noUnusedLocals/noUnusedParameters: true`，比根 tsconfig 严得多。这一步是唯一能抓到"新类型在前端炸了"的门禁。

- [ ] **Step 5: 并存红线逐条确认**

Run: `git diff <base>..HEAD -- src/web/ws/WsHub.ts src/web/ConsoleServer.ts src/web/routes/proxy.ts`

逐条确认：

- [ ] `VALID_CHANNELS` 里 `'proxy.request',` **仍在**（Task 1 只追加，不删）
- [ ] `ConsoleServer.onProxyCaptureListener` 的注册（`start()` :306-319）与解绑（`stop()` :348-352）**一字未改**
- [ ] `src/web/routes/proxy.ts` 的 diff **只有注释行**（`+` 行里不应有可执行代码）
- [ ] `src/web-ui/**`、`src/tools/**`、`NetworkRequestCollector` **零改动**

Expected: 四条全成立。任何一条不成立 → 切片 2 的"随时可回退"前提被破坏，先修再往下走。

- [ ] **Step 6: spec 收尾清单对照**

打开 `docs/superpowers/specs/2026-08-28-unified-capture-view-design.md`，逐条确认：

- [ ] §4 切片 2 变更清单里每一项都有对应 Task（CDP 生产者=Task 2/3、MITM 水槽=Task 4、WS 频道=Task 1/6、REST=Task 5）
- [ ] §8 「静默丢弃要显式化」：未注册频道走 `logger.warn`（不是 `logger.debug`——默认级别是 info，debug 会被短路成空操作，等于没显式化），零订阅者短路用的是 `getSubscriberCount()` 而不是"广播了没人听"
- [ ] §9 两处有意偏离已在 Task 1 / Task 5 里写明理由（类型名字二选一；`createSessionRoutes` 注入取值函数而非实例）
- [ ] §11 测试矩阵后三行全部落地（WsHub 扩展、ConsoleServer 无 engine 不抛、createSessionRoutes 集成测试）
- [ ] §14 切片 2 验收：「集成测试 + 手工一次导航，`captured_requests` 有行、`/api/session/requests` 返回摘要；`proxy.request` 仍在推，UI 仍读旧源」

- [ ] **Step 7: 手工一次导航（§14 验收的一部分，不可跳过）**

1. `npm run build && npm run start` 起服务。
2. 开浏览器导航到任意 http(s) 页面，滚两下触发若干请求。
3. Run: `curl http://127.0.0.1:<port>/api/session/requests?limit=5`
   Expected: `{"items":[...],"total":N}`，`items` 非空，每条只有摘要字段（**没有** `requestBody` / `responseBody` / `requestHeaders`）。
4. 取一条 `id`，Run: `curl http://127.0.0.1:<port>/api/session/requests/<id>`
   Expected: 返回 `SessionRequestDetail`，带 `requestHeaders` / `responseBody`。
5. 订阅 `session.request` WS 频道，再触发一次请求，确认收到 `{"type":"session.request","channel":"session.request","payload":{...}}`。
6. 同时订阅 `proxy.request`，确认**旧频道仍在推**（或至少在 MITM 有流量时仍在推）。
7. 打开抓包页面，确认 UI 行为与切片 2 之前一致（仍读旧源）。

Expected: 3/4/5/6/7 全成立。**第 6 条不成立 → 并存红线被破坏，回退本切片。**

- [ ] **Step 8: 收尾（本 Task 通常无文件可提交）**

Run: `git status --porcelain`

Expected: 干净。若有输出，说明前面某个 Task 漏了提交——先把对应文件按 Task 归属补提交（**只列那一个文件**，不要 `git add -A`），再回到 Step 2 重跑。

---

## 切片 2 完成后的已知遗留（**切片 3 才处理**）

- `proxy.request` WS 频道与 `ConsoleServer.onProxyCaptureListener`：仍在，切片 3 删。
- `/api/proxy/requests`：仍是 MITM-only 调试端点，切片 3 决定去留。
- 前端 `src/web-ui/**`：仍读旧源，切片 3 切。
- MITM 抓包数为 0 的另一桩公案：服务 `running: true` 但 `capturedCount: 0`，因为浏览器启动时没带 `--proxy-server=127.0.0.1:8888`。**与本切片无关**，切片 3 前端切换前必须单独解决，否则 MITM 那一路永远没有数据可切。
- `SessionStore` 接口未加 `countRequests`：`/api/session/requests` 的 `total` 走 `getRequests(session.id, filter).length`，上限就是配额（默认 5000 行）。真实流量超过配额时 `total` 会停在 5000——届时在 `SessionStore` 上加一个 `countRequests(sessionId, filter)` 并在 `SqliteSessionStore` 里用 `SELECT COUNT(*)` 实现。

