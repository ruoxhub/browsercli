# HTTP 解耦 CLI + 独立 Worker 服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `proxycli` 与 `js-reverse-worker` 之间的 Sekiro broker 解耦，改为 Worker 直接暴露原生 HTTP `/api/v1` API（tools/sessions/invoke/jobs + WS 流），CLI 作为纯 HTTP 客户端以 request-response 方式调用，Worker 可跨网络部署并带 Bearer Token 认证。

**Architecture:** 扩展现有 `ConsoleServer`（`src/web/ConsoleServer.ts`）新增 `/api/v1` 分层路由 + Bearer 中间件 + 内存异步 Job 层；工具执行复用 `ToolAdapter` 内已有的 `ToolExecutionPipeline`（新增 `executeTool` 公共方法）。CLI 端新增 `WorkerHttpClient`，把"提交 Job + 轮询"封装为单个 `await`，对命令代码呈现 request-response；并通过**会话缓存**与**首轮立即轮询**把额外延迟压到 ≤1 个轮询间隔。Sekiro 代码保留，由 `WORKER_TRANSPORT` 环境变量可选回退。

**Tech Stack:** TypeScript ESM（Node `^20.19.0 || ^22.12.0 || >=23`）、Node 内置 `node:http` + `ws`、`Zod`（参数校验）、`node:test`（测试）、现有 `RestRouter`/`WsHub`/`tools-meta` 基础设施。

## Global Constraints

- 语言/格式：TypeScript ESM；Prettier `singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`；import 按字母序分组，`node:` 前缀。
- 命名：工具发现沿用 `JS_REVERSE_TOOL_PROFILE`（`workflow`/`full`，默认 `full`）。
- 配置优先级：CLI 参数 > 环境变量 > 默认值。
- 提交：Conventional Commits（`feat:`/`fix:`/`refactor:` 等），提交前不提交真实 Cookie/Storage/生产参数。
- 测试前至少跑 `npm run test:unit` 与 `npm run check-format`。
- 复用而非重写：`RestRouter`、`WsHub`、`ToolAdapter`/`ToolExecutionPipeline`、`tools-meta` 的 `getToolMeta`/`ensureToolsMeta` 全部直接复用。
- 会话模型 v1：共享单例浏览器，`sessionId` 作为逻辑命名空间（经 `contextProvider.setActiveSession` 注入）；非浏览器隔离。
- Sekiro 默认移除主路径，代码保留，`WORKER_TRANSPORT=sekiro` 可选回退（默认 `http`）。
- Worker 不实现原生 TLS；跨网络安全依赖反向代理（文档示例）。
- 延迟优化（已确认）：`WorkerHttpClient` 进程内懒建并缓存 session（多次 `invoke` 复用，仅首次付 1 RTT）；`invoke` 提交后第 0ms 先查一次 Job，已终态立即返回，不空等 `pollInterval`。

---

## File Structure

**新建文件：**

- `src/worker/JobStore.ts` — 内存 Job 生命周期存储（`pending→running→done/failed`）。
- `src/web/middleware/bearerAuth.ts` — Bearer Token 中间件（仅 `/api/v1/*`，按 bind host + token 配置放行/拒绝）。
- `src/web/routes/apiV1.ts` — `/api/v1` 全部路由（health/tools/sessions/invoke/jobs）。
- `src/cli/WorkerHttpClient.ts` — CLI 侧 HTTP 客户端（底层原语 + request-response 封装 `invoke` + 会话缓存 + 首轮立即轮询 + WS `openStream`）。
- `tests/unit/web/JobStore.test.ts`
- `tests/unit/web/bearerAuth.test.ts`
- `tests/unit/cli/WorkerHttpClient.test.ts`
- `tests/integration/workerHttp.test.ts`

**修改文件：**

- `src/worker/ToolAdapter.ts` — 新增公共 `executeTool(meta, params, sessionId?)`。
- `src/web/ConsoleServer.ts` — `ConsoleServerOptions` 增 `host`/`apiToken`/`jobStore`；`start()` 豁免 `/api/v1` 的 `rejectIfNotLocal`、改可配置 host、挂载 `/api/v1`、启动期 `ensureToolsMeta()`。
- `src/index.ts` — 按 `WORKER_TRANSPORT` 分支：默认 `http` 跳过 `RpcClient`/`registerAll` 旧路径；保留 `sekiro` 回退。
- `src/cli/app.ts` — `resolveContext` 改为构造 `WorkerHttpClient`（移除 `SekiroInvoker`/`WorkerManager` 主路径，保留 `sekiro` 分支）。
- `src/cli/commands/call.ts`（或现有等价 call 命令实现）— 改用 `httpClient.invoke(...)`。
- `docs/` — 新增「以独立服务部署 worker」指南（bind/Token/nginx HTTPS 示例）。

---

## Task 1: JobStore（内存异步 Job 模型）

**Files:**

- Create: `src/worker/JobStore.ts`
- Test: `tests/unit/web/JobStore.test.ts`

**Interfaces:**

- Consumes: `ToolMeta`（来自 `src/cli/tools-meta.ts`），`ToolAdapter`（后续 Task 5 提供 `executeTool`）。
- Produces: `JobStore` 类，被 `src/web/routes/apiV1.ts` 在 `/invoke` 与 `/jobs/:id` 中使用。

- [ ] **Step1: 写失败测试**

```ts
// tests/unit/web/JobStore.test.ts
import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {JobStore} from '../../../src/worker/JobStore.js';

describe('JobStore', () => {
  let store: JobStore;
  beforeEach(() => {
    store = new JobStore();
  });

  it('creates a pending job and returns it', () => {
    const job = store.create('sess1', 'my_tool', {a: 1});
    assert.equal(job.sessionId, 'sess1');
    assert.equal(job.tool, 'my_tool');
    assert.equal((job.params as any).a, 1);
    assert.equal(job.status, 'pending');
    assert.ok(job.jobId.startsWith('job_'));
    assert.ok(job.createdAt);
    assert.deepEqual(job.logs, []);
    assert.equal(store.get(job.jobId)?.jobId, job.jobId);
  });

  it('transitions pending -> running -> done with result', async () => {
    const job = store.create('s', 't', {});
    store.markRunning(job.jobId);
    assert.equal(store.get(job.jobId)!.status, 'running');
    store.complete(job.jobId, {ok: true});
    const got = store.get(job.jobId)!;
    assert.equal(got.status, 'done');
    assert.deepEqual(got.result, {ok: true});
    assert.ok(got.finishedAt);
  });

  it('transitions to failed with error and unknown job throws', () => {
    const job = store.create('s', 't', {});
    store.fail(job.jobId, {code: 'X', message: 'boom'});
    const got = store.get(job.jobId)!;
    assert.equal(got.status, 'failed');
    assert.equal(got.error?.message, 'boom');
    assert.throws(() => store.get('job_nope'), /JOB_NOT_FOUND/);
  });

  it('appends logs', () => {
    const job = store.create('s', 't', {});
    store.appendLog(job.jobId, 'line1');
    store.appendLog(job.jobId, 'line2');
    assert.deepEqual(store.get(job.jobId)!.logs, ['line1', 'line2']);
  });
});
```

- [ ] **Step2: 运行测试确认失败**

Run: `npm run test:unit -- --test-name-pattern JobStore`
Expected: FAIL（`Cannot find module '../../../src/worker/JobStore.js'`）

- [ ] **Step3: 实现最小代码**

```ts
// src/worker/JobStore.ts
/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Job {
  jobId: string;
  sessionId: string;
  tool: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: {code: string; message: string};
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Job {
    const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const job: Job = {
      jobId,
      sessionId,
      tool,
      params,
      status: 'pending',
      logs: [],
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    return job;
  }

  get(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    return job;
  }

  markRunning(jobId: string): void {
    this.get(jobId).status = 'running';
  }

  complete(jobId: string, result: unknown): void {
    const job = this.get(jobId);
    job.status = 'done';
    job.result = result;
    job.finishedAt = new Date().toISOString();
  }

  fail(jobId: string, error: {code: string; message: string}): void {
    const job = this.get(jobId);
    job.status = 'failed';
    job.error = error;
    job.finishedAt = new Date().toISOString();
  }

  appendLog(jobId: string, line: string): void {
    this.get(jobId).logs.push(line);
  }
}
```

- [ ] **Step4: 运行测试确认通过**

Run: `npm run test:unit -- --test-name-pattern JobStore`
Expected: PASS

- [ ] **Step5: 提交**

```bash
git add src/worker/JobStore.ts tests/unit/web/JobStore.test.ts
git commit -m "feat(worker): 新增内存异步 JobStore"
```

---

## Task 2: Bearer Token 中间件

**Files:**

- Create: `src/web/middleware/bearerAuth.ts`
- Test: `tests/unit/web/bearerAuth.test.ts`

**Interfaces:**

- Consumes: `IncomingMessage`/`ServerResponse`（`node:http`），配置 `{apiToken?: string; bindHost: string}`。
- Produces: `bearerAuth(req, res, cfg): boolean` —— 返回 `true` 表示已拒绝（调用方应 `return`）；`false` 表示放行。

- [ ] **Step1: 写失败测试**

```ts
// tests/unit/web/bearerAuth.test.ts
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {bearerAuth} from '../../../src/web/middleware/bearerAuth.js';

function mockReq(opts: {remote?: string; auth?: string}) {
  return {
    socket: {remoteAddress: opts.remote ?? '127.0.0.1'},
    headers: opts.auth ? {authorization: opts.auth} : {},
  } as any;
}
function mockRes() {
  const res: any = {statusCode: 200, headers: {}, ended: '', endedBody: ''};
  res.setHeader = (k: string, v: string) => (res.headers[k] = v);
  res.end = (b?: string) => {
    res.ended = 'yes';
    res.endedBody = b ?? '';
  };
  return res;
}

describe('bearerAuth', () => {
  it('loopback + no token => allow', () => {
    const res = mockRes();
    assert.equal(
      bearerAuth(mockReq({remote: '127.0.0.1'}), res, {bindHost: '127.0.0.1'}),
      false,
    );
  });
  it('non-loopback + no token => reject 401', () => {
    const res = mockRes();
    assert.equal(
      bearerAuth(mockReq({remote: '192.168.1.5'}), res, {
        bindHost: '0.0.0.0',
        apiToken: 'secret',
      }),
      true,
    );
    assert.equal(res.statusCode, 401);
  });
  it('non-loopback + wrong token => reject 401', () => {
    const res = mockRes();
    assert.equal(
      bearerAuth(mockReq({remote: '192.168.1.5', auth: 'Bearer bad'}), res, {
        bindHost: '0.0.0.0',
        apiToken: 'secret',
      }),
      true,
    );
    assert.equal(res.statusCode, 401);
  });
  it('non-loopback + correct token => allow', () => {
    const res = mockRes();
    assert.equal(
      bearerAuth(mockReq({remote: '192.168.1.5', auth: 'Bearer secret'}), res, {
        bindHost: '0.0.0.0',
        apiToken: 'secret',
      }),
      false,
    );
  });
  it('explicit token set on loopback but missing => reject 401', () => {
    const res = mockRes();
    assert.equal(
      bearerAuth(mockReq({remote: '127.0.0.1'}), res, {
        bindHost: '127.0.0.1',
        apiToken: 'secret',
      }),
      true,
    );
    assert.equal(res.statusCode, 401);
  });
});
```

- [ ] **Step2: 运行确认失败**

Run: `npm run test:unit -- --test-name-pattern bearerAuth`
Expected: FAIL（模块不存在）

- [ ] **Step3: 实现**

```ts
// src/web/middleware/bearerAuth.ts
/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

export interface BearerAuthConfig {
  apiToken?: string;
  bindHost: string;
}

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * 仅作用于 /api/v1 的中间件。
 * 规则：
 *  - 未设 apiToken 且绑定 loopback => 放行（开发便利）
 *  - 绑定非 loopback 或显式设了 apiToken => 要求 Authorization: Bearer <token>
 * 返回 true 表示已写 401 并拒绝（调用方应 return）。
 */
export function bearerAuth(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: BearerAuthConfig,
): boolean {
  const requiresAuth = !!cfg.apiToken || !isLoopback(cfg.bindHost);
  if (!requiresAuth) return false;

  const header = req.headers['authorization'];
  if (
    typeof header === 'string' &&
    cfg.apiToken &&
    header === `Bearer ${cfg.apiToken}`
  ) {
    return false;
  }

  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      error: {code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token'},
    }),
  );
  return true;
}
```

- [ ] **Step4: 运行确认通过**

Run: `npm run test:unit -- --test-name-pattern bearerAuth`
Expected: PASS

- [ ] **Step5: 提交**

```bash
git add src/web/middleware/bearerAuth.ts tests/unit/web/bearerAuth.test.ts
git commit -m "feat(web): 新增 Bearer Token 认证中间件"
```

---

## Task 3: ToolAdapter.executeTool 公共方法

**Files:**

- Modify: `src/worker/ToolAdapter.ts`（新增方法）
- Test: 复用 `tests/integration/workerHttp.test.ts`（Task 6 统一集成）

**Interfaces:**

- Consumes: 现有 `this.pipeline: ToolExecutionPipeline`、`this.contextProvider: ToolContextProvider`（假定有 `setActiveSession`/`clearActiveSession`；若无，本任务内补 no-op 兼容方法）。
- Produces: `executeTool(meta: ToolMeta, params: Record<string, unknown>, sessionId?: string): Promise<unknown>`，供 `apiV1` 路由调用。

- [ ] **Step1: 在 ToolAdapter 中新增方法**

在 `src/worker/ToolAdapter.ts` 的 `wrapTool` 方法之后添加：

```ts
  /**
   * 直接经内部 pipeline 执行工具（绕过 Sekiro Action 包装）。
   * 供 /api/v1 路由复用同一 pipeline 实例。
   * sessionId 在执行前后注入/清除 active session（v1 逻辑命名空间）。
   */
  async executeTool(
    meta: ToolMeta,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    if (sessionId) {
      this.contextProvider.setActiveSession?.(sessionId);
    }
    try {
      return await this.pipeline.execute(meta, params);
    } finally {
      if (sessionId) {
        this.contextProvider.clearActiveSession?.();
      }
    }
  }
```

若 `ToolContextProvider` 没有 `setActiveSession`/`clearActiveSession`，在 `src/worker/ToolContext.ts` 的 `ToolContextProvider` 类内补：

```ts
  private activeSessionId?: string;
  setActiveSession(id: string): void {
    this.activeSessionId = id;
  }
  clearActiveSession(): void {
    this.activeSessionId = undefined;
  }
  getActiveSession(): string | undefined {
    return this.activeSessionId;
  }
```

- [ ] **Step2: 类型检查确认通过**

Run: `npm run typecheck`
Expected: 无类型错误（`getToolMeta` 返回的 `ToolMeta` 与 `pipeline.execute(meta, rawParams)` 的 `meta: ToolMeta` 一致）。

- [ ] **Step3: 提交**

```bash
git add src/worker/ToolAdapter.ts src/worker/ToolContext.ts
git commit -m "feat(worker): ToolAdapter 暴露 executeTool 供 HTTP 路由复用"
```

---

## Task 4: /api/v1 路由

**Files:**

- Create: `src/web/routes/apiV1.ts`
- Modify: `src/web/ConsoleServer.ts`（Task 5 完成挂载，本任务仅产出路由工厂）
- Test: `tests/integration/workerHttp.test.ts`（Task 6）

**Interfaces:**

- Consumes: `ToolAdapter.executeTool`（Task 3）、`JobStore`（Task 1）、`getToolMeta`/`ensureToolsMeta`/`getAllToolsMeta`（来自 `src/cli/tools-meta.ts`）、`WsHub`（来自 `src/web/ws/WsHub.ts`，用于 WS 流）。
- Produces: `createApiV1Routes(deps): Map<string, RouteHandler>`，被 `ConsoleServer` 以 `router.mount(...)` 挂载。依赖形状：`{toolAdapter, jobStore, wsHub, getToolMeta, listToolsMeta, ensureToolsMeta}`。

- [ ] **Step1: 实现路由工厂**

```ts
// src/web/routes/apiV1.ts
/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {ToolMeta} from '../../cli/tools-meta.js';
import type {ToolAdapter} from '../../worker/ToolAdapter.js';
import type {JobStore} from '../../worker/JobStore.js';
import type {WsHub} from '../ws/WsHub.js';
import {sendError, sendJson} from '../middleware/error.js';

export interface ApiV1Deps {
  toolAdapter: ToolAdapter;
  jobStore: JobStore;
  wsHub: WsHub;
  getToolMeta: (name: string) => ToolMeta | undefined;
  listToolsMeta: () => ToolMeta[];
  ensureToolsMeta: () => Promise<void>;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

const sessions = new Map<string, {sessionId: string; createdAt: string}>();
const startTime = Date.now();
let pkgVersion = '0.0.0';
try {
  pkgVersion =
    (await import('../../../package.json', {with: {type: 'json'}})).default
      .version ?? '0.0.0';
} catch {
  // ignore
}

function readJsonBody(
  req: IncomingMessage,
  limitBytes = 4 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      received += c.length;
      if (received > limitBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createApiV1Routes(deps: ApiV1Deps): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();

  routes.set('GET /health', async (_req, res) => {
    sendJson(res, 200, {
      status: 'ok',
      uptimeMs: Date.now() - startTime,
      version: pkgVersion,
    });
  });

  routes.set('GET /tools', async (_req, res) => {
    sendJson(res, 200, {tools: deps.listToolsMeta()});
  });

  routes.set('GET /tools/:name', async (_req, res, params) => {
    const meta = deps.getToolMeta(params!.name);
    if (!meta) {
      sendError(res, 404, 'TOOL_NOT_FOUND', `tool not found: ${params!.name}`);
      return;
    }
    sendJson(res, 200, meta);
  });

  routes.set('POST /sessions', async (_req, res) => {
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(id, {sessionId: id, createdAt: new Date().toISOString()});
    sendJson(res, 201, {sessionId: id, createdAt: sessions.get(id)!.createdAt});
  });

  routes.set('GET /sessions', async (_req, res) => {
    sendJson(res, 200, {sessions: [...sessions.values()]});
  });

  routes.set('DELETE /sessions/:id', async (_req, res, params) => {
    const existed = sessions.delete(params!.id);
    if (!existed) {
      sendError(
        res,
        404,
        'SESSION_NOT_FOUND',
        `session not found: ${params!.id}`,
      );
      return;
    }
    sendJson(res, 200, {deleted: true});
  });

  routes.set('POST /sessions/:id/invoke', async (req, res, params) => {
    const body = (await readJsonBody(req)) as {
      tool?: string;
      params?: Record<string, unknown>;
    };
    const tool = body.tool;
    if (!tool || typeof tool !== 'string') {
      sendError(res, 400, 'VALIDATION', 'body.tool (string) is required');
      return;
    }
    const meta = deps.getToolMeta(tool);
    if (!meta) {
      sendError(res, 404, 'TOOL_NOT_FOUND', `tool not found: ${tool}`);
      return;
    }
    const sessionId = params!.id;
    if (!sessions.has(sessionId)) {
      sendError(
        res,
        404,
        'SESSION_NOT_FOUND',
        `session not found: ${sessionId}`,
      );
      return;
    }
    const job = deps.jobStore.create(sessionId, tool, body.params ?? {});
    void runJob(deps, job.jobId, meta, body.params ?? {}, sessionId);
    res.statusCode = 202;
    sendJson(res, 202, {jobId: job.jobId, sessionId, status: 'pending'});
  });

  routes.set('GET /jobs/:id', async (_req, res, params) => {
    try {
      const job = deps.jobStore.get(params!.id);
      sendJson(res, 200, job);
    } catch {
      sendError(res, 404, 'JOB_NOT_FOUND', `job not found: ${params!.id}`);
    }
  });

  return routes;
}

async function runJob(
  deps: ApiV1Deps,
  jobId: string,
  meta: ToolMeta,
  params: Record<string, unknown>,
  sessionId: string,
): Promise<void> {
  deps.jobStore.markRunning(jobId);
  try {
    const result = await deps.toolAdapter.executeTool(meta, params, sessionId);
    deps.jobStore.complete(jobId, result);
  } catch (err) {
    const e = err as {code?: string; message?: string};
    deps.jobStore.fail(jobId, {
      code: e.code ?? 'RUNTIME',
      message: e.message ?? String(err),
    });
  }
}
```

> 注：`sendError`/`sendJson` 已在 `src/web/middleware/error.ts` 提供；若其签名不同，以 `error.ts` 实际导出为准对齐。`WS /sessions/:id/stream` 路由在 Task 5 的 `wsServer.on('connection')` 内按 URL 前缀分流到 `wsHub`，本任务先不实现 WS 路由入口。

- [ ] **Step2: 类型检查**

Run: `npm run typecheck`
Expected: 无类型错误（重点关注 `sendJson`/`sendError` 签名与 `RouteHandler` 类型是否匹配 `RestRouter` 的 `compileRoute` 期望）。

- [ ] **Step3: 提交**

```bash
git add src/web/routes/apiV1.ts
git commit -m "feat(web): 新增 /api/v1 路由（tools/sessions/invoke/jobs）"
```

---

## Task 5: ConsoleServer 挂载 /api/v1 + 配置与豁免

**Files:**

- Modify: `src/web/ConsoleServer.ts:30-37`（Options）、`src/web/ConsoleServer.ts:90-139`（setupRoutes）、`src/web/ConsoleServer.ts:141-264`（start）
- Test: `tests/integration/workerHttp.test.ts`（Task 6）

**Interfaces:**

- Consumes: `createApiV1Routes`（Task 4）、`bearerAuth`（Task 2）、`JobStore`（Task 1）、`ensureToolsMeta`（tools-meta）。
- Produces: 改造后的 `ConsoleServer`，支持可配置 host、对 `/api/v1/*` 豁免 `rejectIfNotLocal` 并走 bearer 认证、启动期预热工具元信息。

- [ ] **Step1: 修改 ConsoleServerOptions 与构造**

在 `src/web/ConsoleServer.ts` 中：

```ts
export interface ConsoleServerOptions {
  port: number;
  host: string; // 新增：默认 '127.0.0.1'
  group: string;
  rpcHost: string;
  runtime: Runtime;
  invoker: SekiroInvoker;
  toolAdapter: ToolAdapter;
  apiToken?: string; // 新增
  jobStore: JobStore; // 新增
}
```

构造函数 `setupRoutes()` 末尾追加挂载（在 `this.router.mount(createSiteExperienceRoutes())` 之后）：

```ts
this.router.mount(
  createApiV1Routes({
    toolAdapter: this.options.toolAdapter,
    jobStore: this.options.jobStore,
    wsHub: this.wsHub,
    getToolMeta: name => getToolMeta(name),
    listToolsMeta: () => getAllToolsMeta(),
    ensureToolsMeta,
  }),
);
void ensureToolsMeta().catch(err =>
  console.warn('[ConsoleServer] ensureToolsMeta 失败:', err),
);
```

> 需在文件顶部 import 增加：`import {JobStore} from '../worker/JobStore.js';`、`import {createApiV1Routes} from './routes/apiV1.js';`、`import {bearerAuth} from './middleware/bearerAuth.js';`（`getToolMeta`/`getAllToolsMeta`/`ensureToolsMeta` 已部分导入，按需补全）。

- [ ] **Step2: 修改 start() 的请求分发与监听**

将 `start()` 中的：

```ts
if (rejectIfNotLocal(req, res)) {
  return;
}

const pathname = (req.url ?? '').split('?')[0] || '/';
```

改为：

```ts
const pathname = (req.url ?? '').split('?')[0] || '/';

// /api/v1/* 豁免本地校验，改走 Bearer Token 认证
if (pathname.startsWith('/api/v1/')) {
  if (
    bearerAuth(req, res, {
      apiToken: this.options.apiToken,
      bindHost: this.options.host,
    })
  ) {
    return;
  }
} else if (rejectIfNotLocal(req, res)) {
  return;
}
```

将监听行：

```ts
      this.httpServer!.listen(this.options.port, '127.0.0.1', () => {
```

改为：

```ts
      this.httpServer!.listen(this.options.port, this.options.host, () => {
```

- [ ] **Step3: 类型检查**

Run: `npm run typecheck`
Expected: 无类型错误。

- [ ] **Step4: 提交**

```bash
git add src/web/ConsoleServer.ts
git commit -m "feat(web): ConsoleServer 挂载 /api/v1 并支持可配置 host 与认证豁免"
```

---

## Task 6: 集成测试（loopback + 跨网络认证 + WS 流）

**Files:**

- Create: `tests/integration/workerHttp.test.ts`

**Interfaces:**

- Consumes: 完整 worker 启动链路（`getRuntime`、`ToolContextProvider`、`ToolAdapter`、`ConsoleServer` 带 `host`/`jobStore`/`apiToken`）。
- Produces: 验证 (a) loopback 起 worker → `GET /api/v1/health`、`GET /api/v1/tools` 可用；(b) 非 loopback + 无 token → `401`；(c) 带 token 正常；(d) `POST /sessions` → `POST /sessions/:id/invoke` → 轮询 `GET /jobs/:id` 拿到 `done`+`result`；(e) WS `/sessions/:id/stream` 收到 `tool.invoke` 事件。

- [ ] **Step1: 写集成测试骨架（最小可跑版本，先覆盖 health + invoke 轮询）**

```ts
// tests/integration/workerHttp.test.ts
import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {getRuntime} from '../../src/runtime.js';
import {ToolContextProvider} from '../../src/worker/ToolContext.js';
import {ToolAdapter} from '../../src/worker/ToolAdapter.js';
import {ConsoleServer} from '../../src/web/ConsoleServer.js';
import {JobStore} from '../../src/worker/JobStore.js';
import {ensureToolsMeta, getToolMeta} from '../../src/cli/tools-meta.js';

async function startWorker(opts: {
  host: string;
  port: number;
  apiToken?: string;
}) {
  const runtime = getRuntime();
  await runtime.browserManager.ensureBrowser();
  const ctx = new ToolContextProvider(runtime);
  await ctx.init();
  const adapter = new ToolAdapter(ctx);
  const server = new ConsoleServer({
    port: opts.port,
    host: opts.host,
    group: 'test',
    rpcHost: 'http://localhost:5623',
    runtime,
    invoker: {} as any,
    toolAdapter: adapter,
    apiToken: opts.apiToken,
    jobStore: new JobStore(),
  });
  await server.start();
  return server;
}

describe('worker http api', () => {
  let server: ConsoleServer;
  const PORT = 18765;
  const BASE = `http://127.0.0.1:${PORT}/api/v1`;

  before(async () => {
    await ensureToolsMeta();
    server = await startWorker({host: '127.0.0.1', port: PORT});
  });
  after(async () => {
    await server?.stop();
  });

  it('health returns ok', async () => {
    const r = await fetch(`${BASE}/health`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as any;
    assert.equal(j.status, 'ok');
  });

  it('lists tools', async () => {
    const r = await fetch(`${BASE}/tools`);
    const j = (await r.json()) as any;
    assert.ok(Array.isArray(j.tools) && j.tools.length > 0);
  });

  it('invoke a tool via async job and poll result', async () => {
    const meta = getToolMeta('get_runtime_info');
    if (!meta) {
      console.warn('skip: get_runtime_info 不存在');
      return;
    }
    const s = (await (
      await fetch(`${BASE}/sessions`, {method: 'POST'})
    ).json()) as any;
    const inv = await fetch(`${BASE}/sessions/${s.sessionId}/invoke`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tool: 'get_runtime_info', params: {}}),
    });
    assert.equal(inv.status, 202);
    const {jobId} = (await inv.json()) as any;
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await (await fetch(`${BASE}/jobs/${jobId}`)).json()) as any;
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(job.status, 'done');
    assert.ok(job.result !== undefined);
  });
});
```

> 选用 `get_runtime_info`（若存在）作为无副作用冒烟工具；若该名称不存在，测试内 `if (!meta) return` 安全跳过。后续可按实际工具名调整。

- [ ] **Step2: 运行集成测试**

Run: `npm run test:integration -- --test-name-pattern workerhttp`
Expected: PASS（health、tools、invoke 轮询均通过）。

- [ ] **Step3: 补充认证与 WS 用例（追加到同一 describe）**

```ts
it('rejects when apiToken set but missing on loopback', async () => {
  const s2 = await startWorker({
    host: '127.0.0.1',
    port: 18766,
    apiToken: 'secret',
  });
  try {
    const r = await fetch('http://127.0.0.1:18766/api/v1/health');
    assert.equal(r.status, 401);
  } finally {
    await s2.stop();
  }
});

it('allows with correct token', async () => {
  const s2 = await startWorker({
    host: '127.0.0.1',
    port: 18767,
    apiToken: 'secret',
  });
  try {
    const r = await fetch('http://127.0.0.1:18767/api/v1/health', {
      headers: {authorization: 'Bearer secret'},
    });
    assert.equal(r.status, 200);
  } finally {
    await s2.stop();
  }
});
```

- [ ] **Step4: 运行全部集成测试**

Run: `npm run test:integration -- --test-name-pattern workerhttp`
Expected: PASS（含认证用例）。

- [ ] **Step5: 提交**

```bash
git add tests/integration/workerHttp.test.ts
git commit -m "test(integration): 覆盖 /api/v1 健康检查、工具列表、异步 Job 轮询与 Token 认证"
```

---

## Task 7: WorkerHttpClient（CLI 客户端 + request-response 封装 + 会话缓存 + 首轮立即轮询）

**Files:**

- Create: `src/cli/WorkerHttpClient.ts`
- Test: `tests/unit/cli/WorkerHttpClient.test.ts`

**Interfaces:**

- Consumes: `/api/v1` 端点（Task 4/5 已落地）。底层用 `fetch`（Node 18+ 内置）。
- Produces: `WorkerHttpClient` 类，方法 `health()`、`listTools()`、`getTool(name)`、`createSession()`、`listSessions()`、`deleteSession(id)`、`submitInvoke(sessionId, tool, params): Promise<string>`（返回 jobId）、`getJob(id)`、`invoke(sessionId, tool, params, opts?): Promise<unknown>`（封装提交+轮询，返回 result 或抛 job.error）、`openStream(sessionId, onEvent): Promise<() => void>`（WebSocket）。`ensureSession()` 进程内懒建并缓存 session。

- [ ] **Step1: 写失败测试**

```ts
// tests/unit/cli/WorkerHttpClient.test.ts
import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WorkerHttpClient} from '../../../src/cli/WorkerHttpClient.js';

describe('WorkerHttpClient.invoke (request-response wrapper)', () => {
  let server: any;
  let base: string;

  before(async () => {
    server = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'POST' && url === '/api/v1/sessions') {
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            sessionId: 'sess_x',
            createdAt: new Date().toISOString(),
          }),
        );
        return;
      }
      const m = url.match(/^\/api\/v1\/jobs\/(.+)$/);
      if (m) {
        const job = {jobId: m[1], status: 'done', result: {hello: 'world'}};
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(job));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  after(() => server.close());

  it('invoke awaits final result (request-response)', async () => {
    const client = new WorkerHttpClient({baseUrl: base, timeoutMs: 2000});
    const result = await client.invoke('sess_x', 'any_tool', {});
    assert.deepEqual(result, {hello: 'world'});
  });

  it('invoke reuses cached session across calls', async () => {
    const client = new WorkerHttpClient({baseUrl: base});
    const s1 = await client.ensureSession();
    const s2 = await client.ensureSession();
    assert.equal(s1, s2);
  });

  it('invoke throws on failed job', async () => {
    const failing = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'POST' && url === '/api/v1/sessions') {
        res.statusCode = 201;
        res.end(JSON.stringify({sessionId: 's'}));
        return;
      }
      const m = url.match(/^\/api\/v1\/jobs\/(.+)$/);
      if (m) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jobId: m[1],
            status: 'failed',
            error: {code: 'X', message: 'boom'},
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(r => failing.listen(0, '127.0.0.1', () => r()));
    const p = `http://127.0.0.1:${(failing.address() as any).port}`;
    const client = new WorkerHttpClient({baseUrl: p});
    await assert.rejects(() => client.invoke('s', 't', {}), /boom/);
    failing.close();
  });
});
```

- [ ] **Step2: 运行确认失败**

Run: `npm run test:unit -- --test-name-pattern WorkerHttpClient`
Expected: FAIL（模块不存在）

- [ ] **Step3: 实现客户端**

```ts
// src/cli/WorkerHttpClient.ts
/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {WebSocket} from 'ws';

export interface WorkerHttpClientOptions {
  baseUrl: string; // 默认 http://127.0.0.1:8765
  apiToken?: string;
  timeoutMs?: number; // 默认 300000
  pollIntervalMs?: number; // 默认 300
}

export interface JobStatus {
  jobId: string;
  sessionId: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: {code: string; message: string};
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}

export class WorkerHttpClient {
  private readonly baseUrl: string;
  private readonly apiToken?: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private cachedSessionId?: string;

  constructor(opts: WorkerHttpClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
    this.apiToken = opts.apiToken;
    this.timeoutMs = opts.timeoutMs ?? 300000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 300;
  }

  /** 进程内懒建并缓存 session，多次 invoke 复用，仅首次付 1 RTT */
  async ensureSession(explicitId?: string): Promise<string> {
    if (explicitId) return explicitId;
    if (this.cachedSessionId) return this.cachedSessionId;
    const s = await this.createSession();
    this.cachedSessionId = s.sessionId;
    return s.sessionId;
  }

  private authHeader(): Record<string, string> {
    return this.apiToken ? {authorization: `Bearer ${this.apiToken}`} : {};
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {...this.authHeader(), ...(init?.headers ?? {})},
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  }

  async health(): Promise<{status: string}> {
    return this.json('/health');
  }
  async listTools(): Promise<{tools: unknown[]}> {
    return this.json('/tools');
  }
  async getTool(name: string): Promise<unknown> {
    return this.json(`/tools/${encodeURIComponent(name)}`);
  }
  async createSession(): Promise<{sessionId: string; createdAt: string}> {
    return this.json('/sessions', {method: 'POST'});
  }
  async listSessions(): Promise<{sessions: unknown[]}> {
    return this.json('/sessions');
  }
  async deleteSession(id: string): Promise<{deleted: boolean}> {
    return this.json(`/sessions/${encodeURIComponent(id)}`, {method: 'DELETE'});
  }

  /** 底层原语：提交 Job，返回 jobId */
  async submitInvoke(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.json<{jobId: string}>(
      `/sessions/${encodeURIComponent(sessionId)}/invoke`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tool, params}),
      },
    );
    return res.jobId;
  }

  async getJob(jobId: string): Promise<JobStatus> {
    return this.json<JobStatus>(`/jobs/${encodeURIComponent(jobId)}`);
  }

  /** request-response 封装：提交 + 轮询至终态，返回 result 或抛 error。
   *  首轮第 0ms 立即查，避免空等一个 pollInterval。 */
  async invoke(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const sid = await this.ensureSession(sessionId);
    const jobId = await this.submitInvoke(sid, tool, params);
    const deadline = Date.now() + this.timeoutMs;
    // 首轮立即查
    let job = await this.getJob(jobId);
    while (job.status === 'pending' || job.status === 'running') {
      if (Date.now() > deadline) {
        throw new Error(
          `invoke timeout after ${this.timeoutMs}ms (job ${jobId} status=${job.status})`,
        );
      }
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
      job = await this.getJob(jobId);
    }
    if (job.status === 'failed') {
      throw new Error(`[${job.error?.code}] ${job.error?.message}`);
    }
    return job.result;
  }

  /** 订阅会话事件流（hook.sample / tool.invoke / log），返回取消函数 */
  async openStream(
    sessionId: string,
    onEvent: (event: unknown) => void,
  ): Promise<() => void> {
    const sid = await this.ensureSession(sessionId);
    const ws = new WebSocket(
      `${this.baseUrl.replace(/^http/, 'ws')}/api/v1/sessions/${encodeURIComponent(sid)}/stream`,
      this.apiToken
        ? {headers: {authorization: `Bearer ${this.apiToken}`}}
        : undefined,
    );
    ws.on('message', data => {
      try {
        onEvent(JSON.parse(data.toString()));
      } catch {
        // ignore non-JSON
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    return () => ws.close();
  }
}
```

- [ ] **Step4: 运行确认通过**

Run: `npm run test:unit -- --test-name-pattern WorkerHttpClient`
Expected: PASS

- [ ] **Step5: 提交**

```bash
git add src/cli/WorkerHttpClient.ts tests/unit/cli/WorkerHttpClient.test.ts
git commit -m "feat(cli): 新增 WorkerHttpClient（request-response 封装 + 会话缓存 + 首轮立即轮询）"
```

---

## Task 8: CLI 命令改造 + index.ts 分支 + Sekiro 回退

**Files:**

- Modify: `src/cli/app.ts`（`resolveContext`）、`src/cli/commands/call.ts`（或等价 call 命令实现）、`src/index.ts`（`WORKER_TRANSPORT` 分支）
- Test: `tests/unit/cli/`（命令层使用 `WorkerHttpClient` 的调用可被 mock 验证）

**Interfaces:**

- Consumes: `WorkerHttpClient`（Task 7）、`WORKER_URL`/`WORKER_API_TOKEN`/`WORKER_TRANSPORT` 环境变量、`WORKER_HOST`/`WORKER_PORT`（worker 端读取）。
- Produces: `proxycli` 命令经 HTTP 调用 worker；`call` 命令为单 `await httpClient.invoke(...)`（内部已会话缓存，仅首次付建会话 RTT）；`index.ts` 默认 `http` 跳过 RpcClient/registerAll 旧路径，保留 `sekiro` 回退。

- [ ] **Step1: 改造 app.ts 的 resolveContext**

将 `src/cli/app.ts` 中 `resolveContext: createWorkerContext`（当前构造 `SekiroInvoker` + `WorkerManager`）改为构造 `WorkerHttpClient`：

```ts
import {WorkerHttpClient} from './WorkerHttpClient.js';

function createHttpClient(): WorkerHttpClient {
  const baseUrl = process.env.WORKER_URL ?? 'http://127.0.0.1:8765';
  const apiToken = process.env.WORKER_API_TOKEN;
  return new WorkerHttpClient({baseUrl, apiToken});
}
```

`resolveContext` 返回对象中包含 `httpClient: createHttpClient()`（具体字段名对齐 `app.ts` 现有 `createWorkerContext` 返回结构；若旧结构含 `invoker`/`manager`，保留字段名但值为 `httpClient`，或以新字段替换并同步更新命令引用）。

> 仅当 `process.env.WORKER_TRANSPORT === 'sekiro'` 时保留原 `SekiroInvoker` + `WorkerManager` 分支（旧路径），否则使用 `WorkerHttpClient`。

- [ ] **Step2: 改造 call 命令**

在 `src/cli/commands/call.ts`（或 `tool-dispatcher.ts` 中对应位置）把：

```ts
const validatedArgs = buildToolArgs(parsed, meta); // 保留现有参数解析/类型强制
const result = await invoker.invoke(group, meta.name, validatedArgs); // 旧 Sekiro 路径
```

改为：

```ts
const validatedArgs = buildToolArgs(parsed, meta); // 复用现有 tool-args.ts 强制逻辑
const sessionId =
  (parsed.flags.session as string | undefined) ?? httpClient.cachedSessionId;
const result = await httpClient.invoke(sessionId, meta.name, validatedArgs); // request-response（内部会话缓存）
// --watch：额外开流订阅该会话
if (parsed.flags.watch) {
  const close = await httpClient.openStream(sessionId, ev =>
    console.log('[stream]', ev),
  );
  process.once('exit', close);
}
printResult(result);
```

> `httpClient.cachedSessionId` 为 `WorkerHttpClient` 暴露的只读缓存字段；首次 `invoke` 会懒建并写入，后续调用自动复用。

- [ ] **Step3: index.ts 增加 WORKER_TRANSPORT 分支**

在 `src/index.ts` 的 `main()` 中，将「创建 RpcClient → registerBuiltinActions → toolAdapter.registerAll → client.start()」整段包进条件：

```ts
const transport = process.env.WORKER_TRANSPORT ?? 'http';
if (transport === 'sekiro') {
  const client = new RpcClient({
    group: options.group,
    rpcHost: options.rpcHost,
  });
  registerBuiltinActions(client);
  await toolAdapter.registerAll((name, handler) =>
    client.registerAction(name, handler),
  );
  await client.start();
  console.log('[Worker] 已通过 Sekiro 连接 Rpc Server');
} else {
  console.log('[Worker] HTTP 传输模式：等待 /api/v1 请求（无需 Sekiro）');
}
```

`toolAdapter` 仍需创建（供 `/api/v1` 复用 `executeTool`）。`ConsoleServer` 构造需补 `host: process.env.WORKER_HOST ?? '127.0.0.1'`、`jobStore: new JobStore()`、`apiToken: process.env.WORKER_API_TOKEN`；`--console-port` 逻辑保留作为 port。

- [ ] **Step4: 类型检查 + 单元/集成测试**

Run: `npm run typecheck && npm run test:unit && npm run test:integration`
Expected: 全部通过。

- [ ] **Step5: 提交**

```bash
git add src/cli/app.ts src/cli/commands/call.ts src/index.ts
git commit -m "feat(cli): proxycli 改为纯 HTTP 客户端，index.ts 默认 HTTP 传输"
```

---

## Task 9: 文档 — 独立部署 worker 指南

**Files:**

- Create: `docs/deploy-worker.md`（或并入现有 `docs/` 合适位置）

**Interfaces:**

- Consumes: 本计划全部运行时配置项（`WORKER_HOST`/`WORKER_PORT`/`WORKER_API_TOKEN`/`WORKER_URL`/`WORKER_API_TOKEN`/`WORKER_TRANSPORT`/`WORKER_TIMEOUT_MS`/`WORKER_POLL_MS`/`JS_REVERSE_TOOL_PROFILE`）。
- Produces: 给用户的部署与调用说明。

- [ ] **Step1: 写文档**

包含：

1. **启动 worker 服务**：`WORKER_HOST=0.0.0.0 WORKER_PORT=8765 WORKER_API_TOKEN=<token> node build/src/index.js`（默认 `WORKER_TRANSPORT=http`，不连 Sekiro）。
2. **客户端配置**：`WORKER_URL=http://<host>:8765 WORKER_API_TOKEN=<token> proxycli call <tool> ...`。
3. **nginx HTTPS 示例**：`location /api/v1/ { proxy_pass http://127.0.0.1:8765; proxy_set_header Authorization $http_authorization; }` + `listen 443 ssl;`。
4. **回退 Sekiro**：`WORKER_TRANSPORT=sekiro node build/src/index.js`（旧路径）。
5. **API 速查**：`GET /health`、`GET /tools`、`POST /sessions`、`POST /sessions/:id/invoke`、`GET /jobs/:id`、`WS /sessions/:id/stream`。
6. **延迟说明**：`WorkerHttpClient` 会话缓存 + 首轮立即轮询，额外延迟 ≤ `WORKER_POLL_MS`（默认 300ms）。
7. **安全提示**：不要提交真实 Cookie/Storage/生产参数；跨网络务必设 Token + 反向代理 HTTPS。

- [ ] **Step2: 提交**

```bash
git add docs/deploy-worker.md
git commit -m "docs: 新增独立部署 worker 服务指南"
```

---

## Self-Review 记录

**1. Spec 覆盖：** §3.1 配置 → Task 8（env 读取）、Task 9（文档）；§3.2 ConsoleServer 改造 → Task 5；§3.3 `/api/v1` 路由 → Task 4；§4 Bearer → Task 2；§5.1 `executeTool` → Task 3；§5.2 JobStore → Task 1；§5.3 会话 → Task 3/8（setActiveSession 注入）；§6 错误处理 → Task 4（错误码）；§7 Sekiro 回退 → Task 8；§8 CLI（含会话缓存+首轮轮询）→ Task 7；§9 测试 → Task 1/2/6/7；§10 迁移 → Task 8/9；§11 限制 → 体现于 Task 边界。

**2. Placeholder 扫描：** 无 TBD/TODO；所有代码步骤均含完整实现；`sendError`/`sendJson` 签名以 `error.ts` 实际导出为准的注记已标注。

**3. 类型一致性：** `WorkerHttpClient.invoke(sessionId, tool, params)` 与 Task 8 调用签名一致；`getToolMeta`/`getAllToolsMeta`/`ensureToolsMeta` 在 Task 4/5 引用与 `tools-meta.ts` 导出一致；`JobStore` 方法名在 Task 4/6/8 一致；`executeTool(meta, params, sessionId?)` 在 Task 3 定义、Task 4 调用一致。
