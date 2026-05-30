# JSReverser-CLI 前端工作台实现计划 v2（补丁版）

> 本文是 `2026-05-26-frontend-ui-implementation.md`（v1）的全量修订版。
> v1 中 5 处对现有后端代码的接口假设与实际不符，按原文写法 Phase 1 即编译失败。
> v2 修正全部接口契约，重排 Phase 顺序，新增 Phase 0「接口对齐 PR」，让 traceId 贯穿 pipeline → invocationStore → WS event。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 同 v1 — 为 JSReverser-CLI 构建一个面向逆向工程师的本地 Web 工作台。

**与 v1 的差异（10 项审查意见落地）**

| # | 问题 | v1 假设 | v2 修正 |
|---|------|---------|---------|
| 1 | SekiroInvoker.invoke 签名 | `invoker.invoke(name, args, {timeoutMs})` | 改为 `invoker.invoke(group, action, params)` 三参，timeoutMs 通过构造时配置 |
| 2 | `getRpcHost()` / `getGroup()` 不存在 | 用可选链兜空值 | ConsoleServer ctor 显式接 `group` / `rpcHost` 字段 |
| 3 | ToolExecutionPipeline 拿不到、没 lifecycle | 在 Pipeline 加 EventEmitter | 在 ToolAdapter 增加 `onInvoke(listener)`，pipeline 仍 private |
| 4 | runtime.contextProvider.hookManager / getPages 路径错 | 用可选链糊弄 | hookManager 直接走 `runtime.hookManager`；pages 走 `browserManager.getContext()?.pages()` |
| 5 | apps/web 无法 import src/web/types.ts | tsconfig paths（未配置） | 后端独立维护协议类型，前端复制到 `apps/web/src/lib/protocol.ts` |
| 6 | Phase 顺序：HookSampleBridge 早于 HookStore 事件化 | 鸭子类型监听不存在的 `on()` | Phase 0 先在 HookStore 加 EventEmitter |
| 7 | dev 反代方向反了 | ConsoleServer 反代到 Vite 5173 | 删除 proxy.ts；dev 模式开发者直接访问 5173，由 Vite 反代 8765 |
| 8 | RecentInvocations 命名冲突 | Task 7 内联同名占位 | Task 7 改用 `RecentInvocationsPlaceholder` |
| 9 | traceId 不贯穿 | WS 事件无 traceId，前端无法关联 | Phase 0 把 traceId 加到 ToolResultRecord + AppEventMap，pipeline 内生成 |
| 10 | WsHub 流型频道不该回放 snapshot | 全频道都回放 | Hub 区分 `state` / `stream` 频道，stream 不回放 |

---

## 文件结构（与 v1 主要差异）

### 新增 / 修改

| 文件 | v1 → v2 变化 |
|------|--------------|
| `src/web/proxy.ts` | **删除** |
| `apps/web/src/lib/protocol.ts` | **新增** — 前端独立的协议类型副本（与 `src/web/types.ts` 保持镜像）|
| `apps/web/vite.config.ts` | 已有 proxy 配置即正确，**不改** |
| `src/types/events.ts` | 给 `tool:called` / `tool:error` 加 `traceId` 字段 |
| `src/worker/ToolResultRecorder.ts` | `ToolResultRecord` 加 `traceId` |
| `src/worker/ToolExecutionPipeline.ts` | execute() 头部生成 traceId，emit 时一并带上；不暴露 lifecycle |
| `src/worker/ToolAdapter.ts` | 新增 `onInvoke(listener: (event) => void): () => void` |
| `src/modules/hook/HookStore.ts` | 新增 `events: EventEmitter`，`add()` 内 emit `'sample'` |

其余文件结构与 v1 一致。

---

## Phase 0: 接口对齐 PR（新增，~0.5 day）

> 目的：在动前端/REST 之前，先把现有后端的 4 个接口扩点全部就位，避免后续任务陷入"绕开 private 字段、用可选链糊弄"的死路。

### Task 0.1: 协议字段扩展 — traceId 贯穿事件总线

**Files:**
- Modify: `src/types/events.ts`
- Modify: `src/worker/ToolResultRecorder.ts`

- [ ] **Step 1: 给 AppEventMap 加 traceId**

```typescript
// src/types/events.ts — 仅修改两条
'tool:called': {name: string; durationMs: number; success: boolean; traceId: string};
'tool:error': {name: string; code: string; message: string; traceId: string};
```

同步更新 `appEventSchemas`：

```typescript
'tool:called': z.object({
  name: z.string(),
  durationMs: z.number().finite().nonnegative(),
  success: z.boolean(),
  traceId: z.string(),
}),
'tool:error': z.object({
  name: z.string(),
  code: z.string(),
  message: z.string(),
  traceId: z.string(),
}),
```

- [ ] **Step 2: ToolResultRecord 加 traceId**

```typescript
// src/worker/ToolResultRecorder.ts
export interface ToolResultRecord {
  traceId: string;        // ← 新增
  toolName: string;
  success: boolean;
  // ...其余不变
}
```

- [ ] **Step 3: 验证编译**

```bash
npm run typecheck
```

Expected: PASS（v1 中没有任何调用方依赖 traceId 缺失，新增字段为 required，编译会暴露所有 `record({...})` 调用点。逐一在调用处补上 traceId。）

---

### Task 0.2: ToolExecutionPipeline 生成 traceId 并发布事件

**Files:**
- Modify: `src/worker/ToolExecutionPipeline.ts`
- Modify: `src/worker/ToolTelemetry.ts`

- [ ] **Step 1: pipeline.execute() 生成 traceId**

在现有 `execute()` 顶部（`startedAt` 旁）新增：

```typescript
const traceId = `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
```

把 traceId 传到所有 `telemetry.success` / `telemetry.failure` / `resultRecorder.record` 调用。

- [ ] **Step 2: ToolTelemetry 透传 traceId**

```typescript
// src/worker/ToolTelemetry.ts
success(toolName: string, request: Record<string, unknown>, response: unknown,
        durationMs: number, traceId: string): void {
  // ...
  this.contextProvider.eventBus.emit('tool:called', {
    name: toolName, durationMs, success: true, traceId,
  });
}

failure(toolName: string, error: ToolError, durationMs: number, traceId: string): void {
  this.contextProvider.eventBus.emit('tool:error', {
    name: toolName, code: error.code, message: error.message, traceId,
  });
}
```

- [ ] **Step 3: 验证编译 + 跑一次 worker 单测**

```bash
npm run typecheck && npm run test:worker
```

Expected: PASS

---

### Task 0.3: ToolAdapter 暴露 onInvoke 监听器

**Files:**
- Modify: `src/worker/ToolAdapter.ts`

- [ ] **Step 1: 新增 onInvoke 接口**

> 设计取舍：不在 Pipeline 上加 EventEmitter（v1 做法），改为 ToolAdapter 接 EventBus 上已有的 `tool:called` / `tool:error` 事件。这样 Pipeline 保持纯净，事件流复用现有总线，后续 hook / browser 事件也能走同一通道。

```typescript
// src/worker/ToolAdapter.ts 新增
import type {AppEventMap} from '../types/events.js';

export interface ToolInvokeEventPayload {
  traceId: string;
  toolName: string;
  phase: 'start' | 'end';
  ts: number;
  durationMs?: number;
  success?: boolean;
  error?: {code: string; message: string};
}

export class ToolAdapter {
  // ...existing fields...
  private readonly invokeListeners = new Set<(e: ToolInvokeEventPayload) => void>();
  private invokeBusUnsub?: () => void;

  constructor(private readonly contextProvider: ToolContextProvider) {
    // ...existing ctor body...

    // 接 EventBus 中的 tool:called / tool:error，转译为 ToolInvokeEventPayload
    const bus = contextProvider.eventBus;
    const onSuccess = (p: AppEventMap['tool:called']) => this.dispatch({
      traceId: p.traceId, toolName: p.name, phase: 'end',
      ts: Date.now(), durationMs: p.durationMs, success: true,
    });
    const onFailure = (p: AppEventMap['tool:error']) => this.dispatch({
      traceId: p.traceId, toolName: p.name, phase: 'end',
      ts: Date.now(), success: false,
      error: {code: p.code, message: p.message},
    });
    bus.on('tool:called', onSuccess);
    bus.on('tool:error', onFailure);
    this.invokeBusUnsub = () => {
      bus.off('tool:called', onSuccess);
      bus.off('tool:error', onFailure);
    };
  }

  onInvoke(listener: (event: ToolInvokeEventPayload) => void): () => void {
    this.invokeListeners.add(listener);
    return () => { this.invokeListeners.delete(listener); };
  }

  private dispatch(event: ToolInvokeEventPayload): void {
    for (const fn of this.invokeListeners) {
      try { fn(event); } catch { /* listener 错误不能拖累 worker */ }
    }
  }

  dispose(): void {
    this.invokeBusUnsub?.();
    this.invokeListeners.clear();
  }
}
```

> 注：v2 取消「`phase: 'start'` 事件」。一次工具调用只发 1 条 end 事件就够 UI 用，少一倍流量。后续若要做"运行中工具"列表，再加 start。

- [ ] **Step 2: 验证编译**

```bash
npm run typecheck
```

Expected: PASS

---

### Task 0.4: HookStore 事件化

**Files:**
- Modify: `src/modules/hook/HookStore.ts`

- [ ] **Step 1: 加 EventEmitter，add() 内 emit**

```typescript
// src/modules/hook/HookStore.ts
import {EventEmitter} from 'node:events';

export class HookStore<RecordType> {
  private readonly recordsByHook = new Map<string, RecordType[]>();
  private readonly maxRecordsPerHook: number;
  readonly events = new EventEmitter();

  constructor(maxRecordsPerHook = 1000) {
    this.maxRecordsPerHook = maxRecordsPerHook;
  }

  // ...existing methods...

  add(hookId: string, record: RecordType): void {
    const records = this.recordsByHook.get(hookId) ?? [];
    if (!this.recordsByHook.has(hookId)) {
      this.recordsByHook.set(hookId, records);
    }
    if (records.length >= this.maxRecordsPerHook) {
      records.shift();
    }
    records.push(record);
    // emit 在 push 之后
    this.events.emit('sample', hookId, record);
  }
}
```

- [ ] **Step 2: HookManager 暴露 store**

如 `HookManager` 内已有 `getHookStore()` / `store` 属性可跳过。否则新增：

```typescript
// src/modules/hook/HookManager.ts 内
getHookStore(): HookStore<unknown> { return this.store; }
```

> 实施前先读 HookManager.ts 全文，看现有 store 字段名与可见性。

- [ ] **Step 3: 验证编译**

```bash
npm run typecheck
```

Expected: PASS

---

### Task 0.5: Worker 入口透传 group/rpcHost 给 ConsoleServer

**Files:**
- Modify: `src/index.ts`（仅占位，真实 ConsoleServer 启动在 Phase 3）

不在此 task 启动 ConsoleServer，但把 `options.group` / `options.rpcHost` 在 `main()` 内挂到 module-scope 变量供后续 import：

```typescript
// src/index.ts
export const workerStartContext: {
  group?: string;
  rpcHost?: string;
} = {};

// main() 中:
workerStartContext.group = options.group;
workerStartContext.rpcHost = options.rpcHost;
```

> v2 ConsoleServer ctor 直接接 `{group, rpcHost, runtime, invoker}`，不再尝试从 invoker 上反查。

- [ ] **Commit Phase 0**

```bash
git add src/types/events.ts src/worker/ToolResultRecorder.ts src/worker/ToolExecutionPipeline.ts src/worker/ToolTelemetry.ts src/worker/ToolAdapter.ts src/modules/hook/HookStore.ts src/modules/hook/HookManager.ts src/index.ts
git commit -m "feat(worker): add traceId to event bus, ToolAdapter.onInvoke, HookStore EventEmitter (web console prep)"
```

---

## Phase 1: 协议层 + ConsoleServer 骨架 + 前端布局 (D1-D2)

### Task 1: 共享协议类型（双份，前后端各一）

**Files:**
- Create: `src/web/types.ts`（后端权威）
- Create: `apps/web/src/lib/protocol.ts`（前端镜像，内容相同）

> v2 决策：放弃 tsconfig paths 跨 workspace 引用。两份文件保持手动同步，后续若需要可加 CI 检查 diff。

- [ ] **Step 1: 创建 `src/web/types.ts`**

内容与 v1 Task 1 Step 1 完全一致，但有两处补：

```typescript
// 在 ToolInvokeEvent 上加 phase 字段已存在；此外新增"频道分类"
export type StateChannel = 'worker.status' | 'hook.list';
export type StreamChannel = 'tool.invoke' | 'hook.event' | 'hook.sample' | 'browser.event' | 'log';
export type Channel = StateChannel | StreamChannel;

export const STATE_CHANNELS: ReadonlySet<Channel> = new Set<Channel>([
  'worker.status', 'hook.list',
]);
```

`ToolInvokeEvent` 强制带 traceId：

```typescript
export interface ToolInvokeEvent {
  traceId: string;
  toolName: string;
  phase: 'end';     // v2 暂时只发 end
  ts: number;
  durationMs?: number;
  success: boolean;
  error?: {code: string; message: string};
}
```

`HookSampleEvent` 不变。其余字段同 v1。

- [ ] **Step 2: 复制到 `apps/web/src/lib/protocol.ts`**

```bash
# 第一次直接复制
cp src/web/types.ts apps/web/src/lib/protocol.ts
```

并在文件顶部加注释：

```typescript
// 镜像自 src/web/types.ts — 修改 src/web/types.ts 后请同步本文件
```

- [ ] **Step 3: 验证两侧编译**

```bash
npm run typecheck
cd apps/web && npx tsc --noEmit
```

Expected: PASS

---

### Task 2: WsHub — 频道引擎（区分 state/stream）

**Files:**
- Create: `src/web/ws/WsHub.ts`

v1 Task 2 大体保留，**仅修改 broadcast / subscribe 的 snapshot 行为**：

```typescript
import type {WebSocket} from 'ws';
import {STATE_CHANNELS, type Channel, type ServerMsg} from '../types.js';

interface Subscriber {
  ws: WebSocket;
  filter?: Record<string, unknown>;
}

export class WsHub {
  private readonly channels = new Map<Channel, Set<Subscriber>>();
  // 仅 state 频道维护 lastValue（取代 v1 的环形缓冲做 snapshot）
  private readonly lastState = new Map<Channel, unknown>();

  subscribe(ws: WebSocket, channel: Channel, filter?: Record<string, unknown>): void {
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel)!.add({ws, filter});

    // 仅对 state 频道回放最后一帧
    if (STATE_CHANNELS.has(channel) && this.lastState.has(channel)) {
      const snapshot: ServerMsg = {
        type: 'snapshot', channel, ts: Date.now(),
        payload: this.lastState.get(channel),
      };
      this.send(ws, snapshot);
    }
  }

  unsubscribe(ws: WebSocket, channel?: Channel): void {
    if (channel) {
      const set = this.channels.get(channel);
      if (!set) return;
      for (const sub of set) if (sub.ws === ws) set.delete(sub);
    } else {
      for (const set of this.channels.values()) {
        for (const sub of set) if (sub.ws === ws) set.delete(sub);
      }
    }
  }

  broadcast(
    channel: Channel,
    payload: unknown,
    matchFilter?: (filter: Record<string, unknown> | undefined) => boolean,
  ): void {
    if (STATE_CHANNELS.has(channel)) this.lastState.set(channel, payload);

    const subs = this.channels.get(channel);
    if (!subs) return;

    const msg: ServerMsg = {type: 'event', channel, ts: Date.now(), payload};
    for (const sub of subs) {
      if (matchFilter && !matchFilter(sub.filter)) continue;
      this.send(sub.ws, msg);
    }
  }

  handleClientMessage(ws: WebSocket, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe') this.subscribe(ws, msg.channel, msg.filter);
      else if (msg.type === 'unsubscribe') this.unsubscribe(ws, msg.channel);
      else if (msg.type === 'ping') this.send(ws, {type: 'pong', ts: Date.now()});
    } catch {
      this.send(ws, {type: 'error', code: 'PARSE_ERROR', message: 'Invalid message format'});
    }
  }

  handleDisconnect(ws: WebSocket): void { this.unsubscribe(ws); }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
}
```

- [ ] 验证：`npm run typecheck`

---

### Task 3: InvocationStore（不变）

与 v1 Task 3 完全一致，但 `InvocationRecord` 现在已有 traceId（继承自协议类型）。

---

### Task 4: 中间件 + ZodToJsonSchema 适配器（不变）

与 v1 Task 4 完全一致。

---

### Task 5: REST 路由 — health / worker / tools / invocations（**重写**）

**Files:**
- Create: `src/web/routes/worker.ts`
- Create: `src/web/routes/tools.ts`
- Create: `src/web/routes/invocations.ts`

**关键修正：**
1. invoker.invoke 改三参 `(group, action, params)`
2. group / rpcHost 由 ConsoleServer ctor 传入，不再问 invoker
3. hookManager 走 `runtime.hookManager`，不走 `runtime.contextProvider.hookManager`
4. pages 走 `runtime.browserManager.getContext()?.pages()`
5. getVersion 用 `import.meta.url` 解析，不依赖 cwd

- [ ] **Step 1: worker 路由**

```typescript
// src/web/routes/worker.ts
import type {IncomingMessage, ServerResponse} from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {sendJson} from '../middleware/error.js';
import type {InvocationStore} from '../adapters/InvocationStore.js';
import type {Runtime} from '../../runtime.js';
import type {WorkerFullStatus} from '../types.js';

const startTime = Date.now();
const PKG_VERSION = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // build/src/web/routes → build → repo root
    const pkg = JSON.parse(
      readFileSync(path.resolve(here, '../../../../package.json'), 'utf-8'),
    );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

export interface WorkerRoutesDeps {
  runtime: Runtime;
  group: string;
  rpcHost: string;
  invocationStore: InvocationStore;
}

export function createWorkerRoutes(deps: WorkerRoutesDeps) {
  const {runtime, group, rpcHost} = deps;

  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true, version: PKG_VERSION,
        uptime: Date.now() - startTime, pid: process.pid,
      });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/worker/status') {
      const ctx = runtime.browserManager.getContext?.();
      const pages = ctx?.pages?.() ?? [];
      const browserConnected = !!ctx;

      const hookList = (() => {
        try {
          const store = runtime.hookManager?.getHookStore?.();
          return store?.getHookIds?.() ?? [];
        } catch { return []; }
      })();

      const tools = await import('../../cli/tools-meta.js').then(async m => {
        await m.ensureToolsMeta();
        return m.getAllToolNames();
      }).catch(() => [] as string[]);

      const status: WorkerFullStatus = {
        ok: true, version: PKG_VERSION,
        uptime: Date.now() - startTime, pid: process.pid,
        rpcHost, group,
        browser: {
          connected: browserConnected,
          mode: 'CDP', // TODO Phase 1+: 从 BrowserManager 暴露 mode getter 后填充
          pages: pages.length,
          sessions: browserConnected ? 1 : 0,
        },
        hooks: {total: hookList.length, active: hookList.length, paused: 0},
        tools: {total: tools.length},
      };
      sendJson(res, 200, status);
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/worker/logs') {
      sendJson(res, 200, {lines: [], message: '日志读取将在 P1 实现'});
      return true;
    }

    return false;
  };
}
```

- [ ] **Step 2: tools 路由**

```typescript
// src/web/routes/tools.ts
import type {IncomingMessage, ServerResponse} from 'node:http';
import {sendJson, sendError} from '../middleware/error.js';
import type {InvocationStore} from '../adapters/InvocationStore.js';
import {toolMetaToJsonSchema} from '../adapters/ZodToJsonSchema.js';
import {ensureToolsMeta, getAllToolsMeta, getToolMeta} from '../../cli/tools-meta.js';
import type {SekiroInvoker} from '../../cli/sekiro-invoker.js';

export interface ToolRoutesDeps {
  invoker: SekiroInvoker;
  group: string;
  invocationStore: InvocationStore;
}

export function createToolRoutes({invoker, group, invocationStore}: ToolRoutesDeps) {
  return async function handle(
    req: IncomingMessage, res: ServerResponse, pathname: string,
  ): Promise<boolean> {
    if (req.method === 'GET' && pathname === '/api/tools') {
      await ensureToolsMeta();
      sendJson(res, 200, getAllToolsMeta().map(t => ({
        name: t.name, description: t.description,
        category: t.domain, profile: t.profile,
        argSpecs: t.argSpecs,
        jsonSchema: toolMetaToJsonSchema(t),
      })));
      return true;
    }

    const toolMatch = pathname.match(/^\/api\/tools\/([^/]+)$/);
    if (req.method === 'GET' && toolMatch) {
      const name = decodeURIComponent(toolMatch[1]);
      await ensureToolsMeta();
      const meta = getToolMeta(name);
      if (!meta) { sendError(res, 'TOOL_NOT_FOUND', {toolName: name}); return true; }
      sendJson(res, 200, {
        ...meta,
        jsonSchema: toolMetaToJsonSchema(meta),
        recentInvocations: invocationStore.getRecent(5)
          .filter(i => i.toolName === name),
      });
      return true;
    }

    if (req.method === 'POST' && toolMatch) {
      const name = decodeURIComponent(toolMatch[1]);
      const body = await readBody(req);
      if (!body) { sendError(res, 'INVALID_ARGS', 'Request body required'); return true; }

      // traceId 由 Pipeline 内部生成，REST 这边不再造一份；
      // 但在响应里把 invocationStore 添加的记录回传，前端用 record.traceId
      const startedAt = Date.now();
      try {
        const result = await invoker.invoke(group, name, (body.args ?? {}) as Record<string, unknown>);
        const durationMs = Date.now() - startedAt;
        const rec = invocationStore.add({
          // 此处的 traceId 是 REST 层"外部 traceId"（CLI 同样的语义），
          // 与 Pipeline 内部 traceId 区分；前端展示时优先使用 InvocationRecord.traceId
          traceId: `rest_${Date.now().toString(36)}`,
          toolName: name, success: true,
          startedAt: new Date(startedAt).toISOString(),
          durationMs, args: body.args as Record<string, unknown> | undefined,
          result,
        });
        sendJson(res, 200, {invocationId: rec.id, traceId: rec.traceId, result, durationMs});
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        const rec = invocationStore.add({
          traceId: `rest_${Date.now().toString(36)}`,
          toolName: name, success: false,
          startedAt: new Date(startedAt).toISOString(),
          durationMs, args: body.args as Record<string, unknown> | undefined,
          error: {code: 'TOOL_ERROR', message},
        });
        sendError(res, 'TOOL_ERROR', {toolName: name, message, invocationId: rec.id});
      }
      return true;
    }

    return false;
  };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 1 * 1024 * 1024; // 1 MB 防滥用
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX) { req.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}
```

- [ ] **Step 3: invocations 路由**

与 v1 Task 5 Step 3 完全一致。

- [ ] **Step 4: 验证编译**

```bash
npm run typecheck
```

---

### Task 6: ConsoleServer — 主服务入口（**修改**）

**Files:**
- Create: `src/web/ConsoleServer.ts`
- ~~Create: `src/web/proxy.ts`~~ ❌ **删除该文件**

ConsoleServer ctor 改签名：

```typescript
export interface ConsoleServerOptions {
  port: number;
  group: string;        // ← v2 必填
  rpcHost: string;      // ← v2 必填
  runtime: Runtime;
  invoker: SekiroInvoker;
  toolAdapter: ToolAdapter;  // ← v2 新增（用于注册 onInvoke）
  hookStore?: HookStore<unknown>;  // ← v2 新增
}
```

`handleRequest` 中删除所有 dev 反代分支：

```typescript
// dev 模式下 ConsoleServer 只服务 /api + /ws；前端开发用户访问 5173，由 Vite 反代
private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLocalRequest(req)) { res.writeHead(403); res.end('Forbidden: localhost only'); return; }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const {pathname} = url;

  if (pathname === '/api/health' || pathname.startsWith('/api/worker')) {
    if (await this.handleWorker(req, res, pathname)) return;
  }
  if (pathname.startsWith('/api/tools')) {
    if (await this.handleTools(req, res, pathname)) return;
  }
  if (pathname.startsWith('/api/invocations')) {
    if (await this.handleInvocations(req, res, pathname)) return;
  }
  if (pathname.startsWith('/api/hooks')) {
    if (await this.handleHooks(req, res, pathname)) return;
  }

  // 其余请求：仅尝试静态资源（生产模式有 dist/，dev 模式没有 → 404）
  await this.serveStatic(res, pathname);
}
```

ctor 内同时挂上 ToolInvokeBridge 与 HookSampleBridge（取代 v1 Phase 3 才接入的做法）：

```typescript
constructor(options: ConsoleServerOptions) {
  this.options = options;
  this.wsHub = new WsHub();
  this.invocationStore = new InvocationStore();

  this.handleWorker = createWorkerRoutes({
    runtime: options.runtime, group: options.group, rpcHost: options.rpcHost,
    invocationStore: this.invocationStore,
  });
  this.handleTools = createToolRoutes({
    invoker: options.invoker, group: options.group,
    invocationStore: this.invocationStore,
  });
  this.handleInvocations = createInvocationRoutes(this.invocationStore);
  // hooks routes 在 Phase 3 加

  // 桥接 tool invoke → ws.tool.invoke
  options.toolAdapter.onInvoke((event) => {
    this.wsHub.broadcast('tool.invoke', event);
  });

  // 桥接 hook sample → ws.hook.sample
  options.hookStore?.events.on('sample', (hookId: string, sample: unknown) => {
    this.wsHub.broadcast('hook.sample', {hookId, ...(sample as object)},
      (filter) => !filter?.hookId || filter.hookId === hookId);
  });

  // ...其余 server / wsServer 初始化同 v1
}
```

- [ ] 验证：`npm run typecheck`

---

### Task 7: 前端布局骨架 + 路由 + 概览页（**两处修订**）

**修订 1**：`apps/web/src/lib/api.ts` 中所有类型从 `./protocol` 导入而不是 `src/web/types`：

```typescript
import type {ApiResponse, WorkerFullStatus, /* ... */} from './protocol';
```

**修订 2**：Task 7 Step 6 内联占位的 `RecentInvocationsCard` 改名为 `RecentInvocationsPlaceholder`，以免与 Phase 3 真实组件冲突：

```typescript
function RecentInvocationsPlaceholder() {
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">最近工具调用</h3>
      <p className="text-xs text-[var(--color-text-muted)]">调用历史将在 Phase 3 接入</p>
    </div>
  );
}
```

`OverviewPage` 内引用 `<RecentInvocationsPlaceholder />`，Phase 3 改为 `import {RecentInvocationsCard} from '...'` 后替换之。

`ws.ts` 客户端 `subscribe` 函数：filter 的去重 key 改为只用 channel 名，因为后端 unsubscribe 也只按 channel 解绑：

```typescript
subscribe(channel: Channel, handler: MessageHandler, filter?: Record<string, unknown>): () => void {
  const key = channel; // ← v2 修正
  if (!this.handlers.has(key)) this.handlers.set(key, new Set());
  this.handlers.get(key)!.add(handler);
  if (this.ws?.readyState === WebSocket.OPEN) this.send({type: 'subscribe', channel, filter});

  return () => {
    this.handlers.get(key)?.delete(handler);
    if (this.handlers.get(key)?.size === 0) {
      this.handlers.delete(key);
      if (this.ws?.readyState === WebSocket.OPEN) this.send({type: 'unsubscribe', channel});
    }
  };
}
```

> 多订阅同一 channel 不同 filter 的需求暂不支持（P1 再加）。当前后端 broadcast 已按 filter 分发，前端只接收事件。

其余步骤与 v1 Task 7 一致，验证命令也一致。

- [ ] **Commit Phase 1**

```bash
git add apps/web/src/ src/web/
git commit -m "feat(web): protocol types, ConsoleServer (group/rpcHost wired), WsHub state/stream split, layout skeleton with overview"
```

---

## Phase 2: 工具调用页 + 表单生成 (D3)

与 v1 Task 8 / 9 / 10 一致，**仅一处差异**：

`api.callTool` 的返回类型现在多了 `invocationId`：

```typescript
callTool: (name, args) => request<{
  invocationId: string; traceId: string; result: unknown; durationMs: number;
}>('POST', `/api/tools/${encodeURIComponent(name)}/call`, {args}),
```

`tools.tsx` 中存到 `lastInvocation` 时一并存 invocationId，便于点击跳转到 invocation 详情（P1 功能）。

---

## Phase 3: 概览页实时刷新（**简化**，原 Task 11/12 已并入 Phase 0/1）

### Task 13(v2): 概览页实时数据接入

**Files:**
- Modify: `apps/web/src/routes/overview.tsx`
- Create: `apps/web/src/components/overview/RecentInvocations.tsx`
- Create: `apps/web/src/stores/invocations.ts`

> v1 Task 11 / 12 在 v2 中分别合并到 Phase 0 Task 0.3 / Task 6 ConsoleServer ctor。无需再做。

代码与 v1 Task 13 一致，**但 `Invocation` 类型只保留 `phase: 'end'` 分支**（因为 v2 不再发 start 事件）：

```typescript
interface Invocation {
  traceId: string;
  toolName: string;
  ts: number;
  durationMs: number;
  success: boolean;
  error?: {code: string; message: string};
}

// store.recent 直接是 end 事件列表，无需再 filter phase === 'end'
```

`useEffect` 内：

```typescript
const unsub = wsClient.subscribe('tool.invoke', (msg) => {
  const inv = msg.payload as Invocation;
  if (inv?.traceId) push(inv);
  if (inv?.success === false) {
    setErrorLog(prev => [
      {time: new Date(inv.ts).toLocaleTimeString(), tool: inv.toolName, msg: inv.error?.message ?? 'Unknown'},
      ...prev,
    ].slice(0, 50));
  }
});
```

`App.tsx` 顶部接入 wsClient.connect()（同 v1）。

- [ ] 验证：`cd apps/web && npx tsc --noEmit && npx vite build`
- [ ] Commit Phase 3

---

## Phase 4: Hook 监控页 (D5)

### Task 14: Hook REST API 路由（**修正 invoker.invoke 三参**）

**Files:**
- Create: `src/web/routes/hooks.ts`

构造接 group：

```typescript
export function createHookRoutes(invoker: SekiroInvoker, group: string) {
  return async function handle(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/hooks') {
      try {
        const result = await invoker.invoke(group, 'list_hooks', {});
        sendJson(res, 200, result ?? []);
      } catch (err) {
        sendError(res, 'TOOL_ERROR', {message: err instanceof Error ? err.message : String(err)});
      }
      return true;
    }
    // ...其余路由全部把 invoker.invoke('xxx', body) 改为 invoker.invoke(group, 'xxx', body)
  };
}
```

**所有 invoker.invoke 调用必须三参。** v1 Task 14 中所有路由都要按这个修正。

`ConsoleServer` ctor 中：

```typescript
this.handleHooks = createHookRoutes(this.options.invoker, this.options.group);
```

### Task 15-16: Hook 监控页 + 命令面板

与 v1 一致，**两处修订**：

1. `routes/hooks.tsx` 中调 `api.callTool('list_hooks', {})`，返回值已经是 result 直接拿来用，不要再 `.result`：
   ```typescript
   const result = await api.callTool('list_hooks', {});
   const list = result.result; // callTool 返回 {invocationId, traceId, result, durationMs}
   if (Array.isArray(list)) { useHooksStore.setState({hooks: list}); }
   ```

2. `CommandPalette` 的 `e.key === '/'` 触发条件加防误触：
   ```typescript
   const handler = (e: KeyboardEvent) => {
     const tag = (e.target as HTMLElement)?.tagName;
     const inEditable = tag === 'INPUT' || tag === 'TEXTAREA'
       || (e.target as HTMLElement)?.isContentEditable;
     if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) ||
         (e.key === '/' && !inEditable)) {
       e.preventDefault();
       setOpen(prev => !prev);
     }
     if (e.key === 'Escape') setOpen(false);
   };
   ```

### Task 17(v2): 删除 — Phase 0 已完成

v1 Task 17 全部内容（HookStore EventEmitter + HookSampleBridge）已在 Phase 0 Task 0.4 + Phase 1 Task 6 完成。**v2 删除此 task。**

---

## 验收清单 (P0)

与 v1 一致，**新增三条**：

- [ ] 触发任一 CLI 工具调用，概览页"最近工具调用"出现新行，且 `traceId` 字段非空
- [ ] 同一工具的 InvocationLog 可通过 `traceId` 与 `/api/invocations` 中的记录关联
- [ ] 浏览器控制台 WS 消息中，`tool.invoke` 频道每次工具调用只收到 1 条 end 事件（不重复发 start/end）
- [ ] 新订阅者**不会**收到历史 `tool.invoke` 事件（仅 `worker.status` / `hook.list` 这类 state 频道才回放）

---

## 自检结果

**1. 与现有代码契约对齐**：v2 Phase 0 已把 5 处接口扩点全部纳入计划首阶段，不再依赖"代码里其实有的可选链兜底"。

**2. Phase 顺序合理**：HookStore EventEmitter（Phase 0）→ ConsoleServer 接 store.events（Phase 1 Task 6）→ HookSampleBridge 在 ctor 内即生效，不需要等 Phase 4。

**3. traceId 链路闭合**：Pipeline 生成 → AppEventMap → ToolAdapter.onInvoke → WsHub → 前端 store key。

**4. 双份协议类型的同步成本**：可接受（~80 行类型，月级别变化频次）。后续可加 CI step：`diff <(tail -n +2 src/web/types.ts) <(tail -n +2 apps/web/src/lib/protocol.ts)`。

**5. 删除项确认**：`src/web/proxy.ts`（dev 反代方向反了，不需要）；v1 Task 17（已并入 Phase 0/1）。

---

**v2 Plan complete. Two execution options:**

**1. Subagent-Driven (recommended)** — 每个 Phase 独立 subagent，主上下文做 review。

**2. Inline Execution** — 在当前会话用 superpowers:executing-plans 顺序跑。

**哪种？**
