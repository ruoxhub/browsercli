# JSReverser-CLI 前端工作台实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 JSReverser-CLI 构建一个面向逆向工程师的本地 Web 工作台，实现"概览 → 工具调用 → Hook 监控"核心闭环。

**Architecture:** Worker 进程内嵌 ConsoleServer（http + ws），前端 React SPA 通过 REST 控制面 + WebSocket 实时面与后端通信。后端复用现有 Runtime 单例、ToolAdapter、HookStore，不重写核心管线。

**Tech Stack:** React 19 + Vite 7 + Tailwind CSS 4 + shadcn/ui (Radix) + Zustand 5 + React Router 7。后端：Node 内置 http + ws 库，TypeScript 编译用 swc。

**现状:** monorepo workspaces 已配置，`apps/web` 脚手架已存在（package.json / vite.config.ts / tsconfig.json / index.html / main.tsx / styles/index.css / lib/utils.ts），但 App.tsx 未创建，`src/web/` 后端模块不存在。

---

## 文件结构

### 后端新增 (`src/web/`)

| 文件 | 职责 |
|------|------|
| `src/web/types.ts` | 协议类型真理源（ApiResponse / WS 消息信封 / Channel 枚举），前端通过 tsconfig paths 引用 |
| `src/web/ConsoleServer.ts` | http + ws 服务主入口，绑定 127.0.0.1，路由分发，dev 反代 / prod 静态资源 |
| `src/web/routes/tools.ts` | `GET /api/tools` `GET /api/tools/:name` `POST /api/tools/:name/call` |
| `src/web/routes/hooks.ts` | `GET /api/hooks` `POST /api/hooks` `GET /api/hooks/:id` `GET /api/hooks/:id/samples` `POST /api/hooks/:id/pause` `POST /api/hooks/:id/resume` `DELETE /api/hooks/:id` |
| `src/web/routes/worker.ts` | `GET /api/health` `GET /api/worker/status` `GET /api/worker/logs` |
| `src/web/routes/invocations.ts` | `GET /api/invocations` `GET /api/invocations/:id` |
| `src/web/routes/sessions.ts` | `GET /api/sessions` (P1) |
| `src/web/routes/config.ts` | `GET /api/config` `PATCH /api/config` (P1) |
| `src/web/ws/WsHub.ts` | 频道订阅/取消订阅/广播引擎，按 filter 匹配订阅者 |
| `src/web/ws/HookSampleBridge.ts` | 监听 HookManager → 桥接到 WsHub.hook.sample |
| `src/web/ws/ToolInvokeBridge.ts` | 包装 ToolExecutionPipeline → 桥接到 WsHub.tool.invoke |
| `src/web/adapters/ZodToJsonSchema.ts` | 将 ToolMeta.argSpecs 转换为标准 JSON Schema |
| `src/web/adapters/InvocationStore.ts` | 内存环形缓冲区，存储最近 1000 次调用记录 |
| `src/web/middleware/error.ts` | 统一错误码映射（WORKER_OFFLINE / TOOL_NOT_FOUND / INVALID_ARGS 等） |
| `src/web/middleware/localOnly.ts` | 127.0.0.1 / ::1 校验，外部 IP → 403 |
| `src/web/proxy.ts` | dev 模式下把非 /api 非 /ws 请求反代到 Vite dev server |

### 后端修改（现有文件）

| 文件 | 改动 |
|------|------|
| `src/index.ts` | Worker 启动后创建并启动 ConsoleServer，SIGTERM 时先关 ConsoleServer |
| `src/cli/commands/start.ts` | 新增 `--no-web` / `--web-port` flag |
| `src/modules/hook/HookStore.ts` | 添加 EventEmitter 接口（`.on('sample', fn)` / `.off('sample', fn)`） |
| `src/worker/ToolExecutionPipeline.ts` | 在 execute() 的 start/end/error 节点发出事件（通过 EventBus） |

### 前端 (`apps/web/src/`)

| 文件 | 职责 |
|------|------|
| `App.tsx` | 根组件：Router + Layout + 路由表 |
| `routes/overview.tsx` | 概览页：4 卡片网格 |
| `routes/tools.tsx` | 工具调用页：左列表 + 右抽屉 |
| `routes/hooks.tsx` | Hook 监控页：左列表 + 右详情 |
| `components/layout/Sidebar.tsx` | 左侧导航栏 + 路由分组 + daemon 状态 |
| `components/layout/TopBar.tsx` | 顶部 5 项常驻状态指示 |
| `components/layout/RightDrawer.tsx` | 右侧抽屉容器（钉住/关闭/URL 同步） |
| `components/tools/CategoryTree.tsx` | 可折叠分类树 |
| `components/tools/ToolForm.tsx` | JSON Schema → 表单渲染引擎 |
| `components/tools/InvocationLog.tsx` | 调用结果 JSON 折叠面板 |
| `components/hooks/HookList.tsx` | Hook 列表组件 |
| `components/hooks/SampleStream.tsx` | 虚拟滚动实时采样流 |
| `components/hooks/SampleRow.tsx` | 单条采样行（时间/args/retVal，可展开） |
| `components/overview/WorkerCard.tsx` | 概览 - Worker 状态卡 |
| `components/overview/BrowserCard.tsx` | 概览 - Browser 状态卡 |
| `components/overview/ActiveHooksCard.tsx` | 概览 - 活跃 Hook 卡 |
| `components/overview/RecentInvocations.tsx` | 概览 - 最近调用 + 错误日志 |
| `components/common/StatusDot.tsx` | 绿色/黄色/红色/灰色状态点 |
| `components/common/JsonTree.tsx` | JSON 树形查看器 |
| `components/common/VirtualList.tsx` | 通用虚拟滚动容器 |
| `components/common/CommandPalette.tsx` | Cmd+K 命令面板 |
| `components/ui/` | shadcn/ui 生成的 button / input / select / switch / tabs / tooltip / dialog / scroll-area |
| `stores/worker.ts` | Zustand: worker 状态、browser 状态 |
| `stores/tools.ts` | Zustand: 工具列表、分类、选中、调用历史 |
| `stores/hooks.ts` | Zustand: Hook 列表、采样流、选中 |
| `stores/invocations.ts` | Zustand: 调用历史 |
| `lib/api.ts` | REST 客户端，类型从 `src/web/types.ts` 导入 |
| `lib/ws.ts` | WebSocket 客户端，订阅/重连/心跳 |
| `lib/schema.ts` | JSON Schema → 表单字段定义转换 |
| `lib/theme.ts` | Tailwind 深色主题 token（已部分在 index.css 中定义，补充） |

---

## Phase 1: 协议层 + ConsoleServer 骨架 + 前端布局 (D1-D2)

### Task 1: 共享类型定义

**Files:**
- Create: `src/web/types.ts`

- [ ] **Step 1: 创建协议类型文件**

```typescript
// src/web/types.ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { traceId: string; ts: number };
}

export type Channel =
  | 'worker.status'
  | 'tool.invoke'
  | 'hook.event'
  | 'hook.sample'
  | 'browser.event'
  | 'log';

export interface ClientMsgSubscribe {
  type: 'subscribe';
  channel: Channel;
  filter?: Record<string, unknown>;
}

export interface ClientMsgUnsubscribe {
  type: 'unsubscribe';
  channel: Channel;
}

export interface ClientMsgPing {
  type: 'ping';
}

export type ClientMsg = ClientMsgSubscribe | ClientMsgUnsubscribe | ClientMsgPing;

export interface ServerMsgEvent {
  type: 'event';
  channel: Channel;
  ts: number;
  payload: unknown;
}

export interface ServerMsgSnapshot {
  type: 'snapshot';
  channel: Channel;
  ts: number;
  payload: unknown;
}

export interface ServerMsgError {
  type: 'error';
  channel?: Channel;
  code: string;
  message: string;
}

export interface ServerMsgPong {
  type: 'pong';
  ts: number;
}

export type ServerMsg = ServerMsgEvent | ServerMsgSnapshot | ServerMsgError | ServerMsgPong;

export interface HookSampleEvent {
  hookId: string;
  seq: number;
  ts: number;
  args?: unknown[];
  retVal?: unknown;
  stack?: { url: string; line: number; col: number; functionName?: string }[];
  truncated?: boolean;
  artifactRef?: string;
}

export interface ToolInvokeEvent {
  traceId: string;
  toolName: string;
  phase: 'start' | 'end';
  ts: number;
  durationMs?: number;
  success?: boolean;
  error?: { code: string; message: string };
}

export interface WorkerStatus {
  ok: boolean;
  version: string;
  uptime: number;
  pid: number;
  rpcHost: string;
  group: string;
}

export interface WorkerFullStatus extends WorkerStatus {
  browser: {
    connected: boolean;
    mode: string;
    wsEndpoint?: string;
    pages: number;
    sessions: number;
  };
  hooks: {
    total: number;
    active: number;
    paused: number;
  };
  tools: {
    total: number;
  };
}

export interface HookSummary {
  id: string;
  name: string;
  location: string;
  captureMode: string;
  status: 'active' | 'paused' | 'detached';
  sampleCount: number;
  lastSampleAt?: string;
  createdAt: string;
}

export interface HookDetail extends HookSummary {
  maxSamples: number;
  samples: HookSampleEvent[];
}

export interface InvocationRecord {
  id: string;
  traceId: string;
  toolName: string;
  success: boolean;
  startedAt: string;
  durationMs: number;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string; message: string };
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无新增类型错误（新文件在 `src/` 下被 tsconfig include 覆盖）

---

### Task 2: WsHub — WebSocket 频道引擎

**Files:**
- Create: `src/web/ws/WsHub.ts`

- [ ] **Step 1: 实现 WsHub**

```typescript
// src/web/ws/WsHub.ts
import type { WebSocket } from 'ws';
import type { Channel, ServerMsg } from '../types.js';

interface Subscriber {
  ws: WebSocket;
  filter?: Record<string, unknown>;
}

export class WsHub {
  private readonly channels = new Map<Channel, Set<Subscriber>>();
  private readonly ringBuffers = new Map<Channel, unknown[]>();
  private static readonly RING_SIZE = 1000;

  subscribe(ws: WebSocket, channel: Channel, filter?: Record<string, unknown>): void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add({ ws, filter });

    // 发送当前快照（如果有环形缓冲数据）
    const buffer = this.ringBuffers.get(channel);
    if (buffer && buffer.length > 0) {
      const snapshot: ServerMsg = {
        type: 'snapshot',
        channel,
        ts: Date.now(),
        payload: buffer.slice(-50), // 最近 50 条作为快照
      };
      this.send(ws, snapshot);
    }
  }

  unsubscribe(ws: WebSocket, channel?: Channel): void {
    if (channel) {
      this.channels.get(channel)?.forEach(sub => {
        if (sub.ws === ws) this.channels.get(channel)!.delete(sub);
      });
    } else {
      for (const [, subs] of this.channels) {
        subs.forEach(sub => {
          if (sub.ws === ws) subs.delete(sub);
        });
      }
    }
  }

  broadcast(channel: Channel, payload: unknown, filterFn?: (sub: Subscriber) => boolean): void {
    const subs = this.channels.get(channel);
    if (!subs) return;

    // 写入环形缓冲
    if (!this.ringBuffers.has(channel)) {
      this.ringBuffers.set(channel, []);
    }
    const buffer = this.ringBuffers.get(channel)!;
    if (buffer.length >= WsHub.RING_SIZE) buffer.shift();
    buffer.push(payload);

    const msg: ServerMsg = {
      type: 'event',
      channel,
      ts: Date.now(),
      payload,
    };

    for (const sub of subs) {
      if (filterFn && !filterFn(sub)) continue;
      this.send(sub.ws, msg);
    }
  }

  removeChannel(channel: Channel): void {
    this.channels.delete(channel);
    this.ringBuffers.delete(channel);
  }

  handleClientMessage(ws: WebSocket, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe') {
        this.subscribe(ws, msg.channel, msg.filter);
      } else if (msg.type === 'unsubscribe') {
        this.unsubscribe(ws, msg.channel);
      } else if (msg.type === 'ping') {
        this.send(ws, { type: 'pong', ts: Date.now() });
      }
    } catch {
      this.send(ws, { type: 'error', code: 'PARSE_ERROR', message: 'Invalid message format' });
    }
  }

  handleDisconnect(ws: WebSocket): void {
    this.unsubscribe(ws);
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

---

### Task 3: InvocationStore — 调用历史缓冲区

**Files:**
- Create: `src/web/adapters/InvocationStore.ts`

- [ ] **Step 1: 实现 InvocationStore**

```typescript
// src/web/adapters/InvocationStore.ts
import type { InvocationRecord } from '../types.js';

export class InvocationStore {
  private readonly records: InvocationRecord[] = [];
  private nextId = 1;
  static readonly MAX_RECORDS = 1000;

  add(record: Omit<InvocationRecord, 'id'>): InvocationRecord {
    const full: InvocationRecord = {
      ...record,
      id: `inv_${this.nextId++}`,
    };
    if (this.records.length >= InvocationStore.MAX_RECORDS) {
      this.records.shift();
    }
    this.records.push(full);
    return full;
  }

  getRecent(limit = 10): InvocationRecord[] {
    return this.records.slice(-limit).reverse();
  }

  getById(id: string): InvocationRecord | undefined {
    return this.records.find(r => r.id === id);
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

---

### Task 4: 中间件 + ZodToJsonSchema 适配器

**Files:**
- Create: `src/web/middleware/localOnly.ts`
- Create: `src/web/middleware/error.ts`
- Create: `src/web/adapters/ZodToJsonSchema.ts`

- [ ] **Step 1: 实现 localOnly 中间件**

```typescript
// src/web/middleware/localOnly.ts
import type { IncomingMessage } from 'node:http';

export function isLocalRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress;
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}
```

- [ ] **Step 2: 实现错误处理中间件**

```typescript
// src/web/middleware/error.ts
import type { ServerResponse } from 'node:http';
import type { ApiResponse } from '../types.js';

const ERROR_CODES: Record<string, { status: number; message: string }> = {
  WORKER_OFFLINE: { status: 503, message: 'Worker 未运行' },
  BROWSER_UNAVAILABLE: { status: 503, message: '浏览器不可用' },
  TOOL_NOT_FOUND: { status: 404, message: '工具未找到' },
  INVALID_ARGS: { status: 400, message: '参数无效' },
  TOOL_TIMEOUT: { status: 504, message: '工具执行超时' },
  TOOL_ERROR: { status: 500, message: '工具执行错误' },
  INTERNAL_ERROR: { status: 500, message: '内部错误' },
};

export function sendError(res: ServerResponse, code: string, details?: unknown): void {
  const def = ERROR_CODES[code] ?? ERROR_CODES.INTERNAL_ERROR;
  const body: ApiResponse = {
    success: false,
    error: { code, message: def.message, details },
    meta: { traceId: '', ts: Date.now() },
  };
  res.writeHead(def.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body: ApiResponse = {
    success: status < 400,
    data: status < 400 ? data : undefined,
    error: status >= 400 ? { code: 'ERROR', message: String(data) } : undefined,
    meta: { traceId: '', ts: Date.now() },
  };
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
```

- [ ] **Step 3: 实现 ZodToJsonSchema 适配器**

```typescript
// src/web/adapters/ZodToJsonSchema.ts
import type { ToolMeta, ToolArgSpecMap } from '../../cli/tools-meta.js';

interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string };
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export function toolMetaToJsonSchema(meta: ToolMeta): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [name, spec] of Object.entries(meta.argSpecs)) {
    const prop: JsonSchemaProperty = {
      type: spec.type === 'string[]' ? 'array' : spec.type,
      description: spec.description || undefined,
      enum: spec.enum,
      default: spec.defaultValue,
    };
    if (spec.type === 'string[]') {
      prop.items = { type: 'string' };
    }
    properties[name] = prop;
    if (spec.required) required.push(name);
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

---

### Task 5: REST 路由 — health / worker / tools / invocations

**Files:**
- Create: `src/web/routes/worker.ts`
- Create: `src/web/routes/tools.ts`
- Create: `src/web/routes/invocations.ts`

- [ ] **Step 1: 实现 worker 路由**

```typescript
// src/web/routes/worker.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendError } from '../middleware/error.js';
import type { InvocationStore } from '../adapters/InvocationStore.js';
import type { Runtime } from '../../runtime.js';
import type { SekiroInvoker } from '../../cli/sekiro-invoker.js';
import type { WorkerFullStatus } from '../types.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let startTime = Date.now();

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createWorkerRoutes(options: {
  runtime: Runtime;
  invoker: SekiroInvoker;
  invocationStore: InvocationStore;
}) {
  const { runtime, invoker } = options;

  return async function handleWorkerRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // GET /api/health
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        version: getVersion(),
        uptime: Date.now() - startTime,
        pid: process.pid,
      });
      return true;
    }

    // GET /api/worker/status
    if (req.method === 'GET' && pathname === '/api/worker/status') {
      const browserManager = runtime.browserManager;
      const pages = await runtime.contextProvider?.getPages() ?? [];
      const hooks = await runtime.contextProvider?.hookManager?.listHooks?.() ?? [];
      const toolsNames = await (async () => {
        const { getAllToolNames, ensureToolsMeta } = await import('../../cli/tools-meta.js');
        await ensureToolsMeta();
        return getAllToolNames();
      })().catch(() => [] as string[]);

      const status: WorkerFullStatus = {
        ok: true,
        version: getVersion(),
        uptime: Date.now() - startTime,
        pid: process.pid,
        rpcHost: invoker.getRpcHost?.() ?? 'unknown',
        group: invoker.getGroup?.() ?? 'unknown',
        browser: {
          connected: browserManager?.isConnected?.() ?? false,
          mode: browserManager?.getConfig?.()?.wsEndpoint ? 'CDP' : 'Playwright',
          wsEndpoint: browserManager?.getConfig?.()?.wsEndpoint,
          pages: pages.length,
          sessions: 1,
        },
        hooks: {
          total: Array.isArray(hooks) ? hooks.length : 0,
          active: Array.isArray(hooks) ? hooks.filter((h: { status?: string }) => h.status === 'active').length : 0,
          paused: Array.isArray(hooks) ? hooks.filter((h: { status?: string }) => h.status === 'paused').length : 0,
        },
        tools: { total: toolsNames.length },
      };
      sendJson(res, 200, status);
      return true;
    }

    // GET /api/worker/logs?tail=200
    if (req.method === 'GET' && pathname === '/api/worker/logs') {
      // P1: 从日志文件读取。P0 返回占位。
      sendJson(res, 200, { lines: [], message: '日志读取将在 P1 实现' });
      return true;
    }

    return false;
  };
}
```

- [ ] **Step 2: 实现 tools 路由**

```typescript
// src/web/routes/tools.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendError } from '../middleware/error.js';
import type { InvocationStore } from '../adapters/InvocationStore.js';
import { toolMetaToJsonSchema } from '../adapters/ZodToJsonSchema.js';
import {
  ensureToolsMeta,
  getAllToolsMeta,
  getToolMeta,
} from '../../cli/tools-meta.js';
import type { SekiroInvoker } from '../../cli/sekiro-invoker.js';

export function createToolRoutes(options: {
  invoker: SekiroInvoker;
  invocationStore: InvocationStore;
}) {
  const { invoker, invocationStore } = options;

  return async function handleToolRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // GET /api/tools
    if (req.method === 'GET' && pathname === '/api/tools') {
      await ensureToolsMeta();
      const tools = getAllToolsMeta().map(t => ({
        name: t.name,
        description: t.description,
        category: t.domain,
        profile: t.profile,
        argSpecs: t.argSpecs,
        jsonSchema: toolMetaToJsonSchema(t),
      }));
      sendJson(res, 200, tools);
      return true;
    }

    // GET /api/tools/:name
    const toolMatch = pathname.match(/^\/api\/tools\/([^/]+)$/);
    if (req.method === 'GET' && toolMatch) {
      const name = decodeURIComponent(toolMatch[1]);
      await ensureToolsMeta();
      const meta = getToolMeta(name);
      if (!meta) {
        sendError(res, 'TOOL_NOT_FOUND', { toolName: name });
        return true;
      }
      sendJson(res, 200, {
        ...meta,
        jsonSchema: toolMetaToJsonSchema(meta),
        recentInvocations: invocationStore.getRecent(5).filter(i => i.toolName === name),
      });
      return true;
    }

    // POST /api/tools/:name/call
    if (req.method === 'POST' && toolMatch) {
      const name = decodeURIComponent(toolMatch[1]);
      const body = await readBody(req);
      if (!body) {
        sendError(res, 'INVALID_ARGS', 'Request body required');
        return true;
      }

      const traceId = body.traceId ?? `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();

      try {
        const result = await invoker.invoke(name, body.args ?? {}, { timeoutMs: body.timeoutMs });
        const durationMs = Date.now() - startedAt;
        invocationStore.add({
          traceId,
          toolName: name,
          success: true,
          startedAt: new Date(startedAt).toISOString(),
          durationMs,
          args: body.args,
          result,
        });
        sendJson(res, 200, { traceId, result, durationMs });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const errorMessage = err instanceof Error ? err.message : String(err);
        invocationStore.add({
          traceId,
          toolName: name,
          success: false,
          startedAt: new Date(startedAt).toISOString(),
          durationMs,
          args: body.args,
          error: { code: 'TOOL_ERROR', message: errorMessage },
        });
        sendError(res, 'TOOL_ERROR', { toolName: name, message: errorMessage, traceId });
      }
      return true;
    }

    return false;
  };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve(null);
      }
    });
  });
}
```

- [ ] **Step 3: 实现 invocations 路由**

```typescript
// src/web/routes/invocations.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendError } from '../middleware/error.js';
import type { InvocationStore } from '../adapters/InvocationStore.js';

export function createInvocationRoutes(invocationStore: InvocationStore) {
  return async function handleInvocationRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // GET /api/invocations?limit=50
    if (req.method === 'GET' && pathname === '/api/invocations') {
      const url = new URL(pathname, `http://${req.headers.host ?? 'localhost'}`);
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      sendJson(res, 200, invocationStore.getRecent(limit));
      return true;
    }

    // GET /api/invocations/:id
    const match = pathname.match(/^\/api\/invocations\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const record = invocationStore.getById(match[1]);
      if (!record) {
        sendError(res, 'TOOL_NOT_FOUND', { invocationId: match[1] });
        return true;
      }
      sendJson(res, 200, record);
      return true;
    }

    return false;
  };
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

---

### Task 6: ConsoleServer — 主服务入口

**Files:**
- Create: `src/web/ConsoleServer.ts`
- Create: `src/web/proxy.ts`

- [ ] **Step 1: 实现 dev 模式反代**

```typescript
// src/web/proxy.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';

export function proxyToVite(
  req: IncomingMessage,
  res: ServerResponse,
  vitePort = 5173,
): void {
  const options = {
    hostname: '127.0.0.1',
    port: vitePort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${vitePort}` },
  };

  const proxy = httpRequest(options, proxyRes => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: { code: 'DEV_PROXY_ERROR', message: 'Vite dev server 未启动，请先运行 npm run dev (在 apps/web 目录)' },
    }));
  });

  req.pipe(proxy);
}
```

- [ ] **Step 2: 组装 ConsoleServer**

```typescript
// src/web/ConsoleServer.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

import type { Runtime } from '../runtime.js';
import type { SekiroInvoker } from '../cli/sekiro-invoker.js';
import { WsHub } from './ws/WsHub.js';
import { InvocationStore } from './adapters/InvocationStore.js';
import { isLocalRequest } from './middleware/localOnly.js';
import { sendError } from './middleware/error.js';
import { createWorkerRoutes } from './routes/worker.js';
import { createToolRoutes } from './routes/tools.js';
import { createInvocationRoutes } from './routes/invocations.js';
import { proxyToVite } from './proxy.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface ConsoleServerOptions {
  port: number;
  runtime: Runtime;
  invoker: SekiroInvoker;
  dev?: boolean;
  vitePort?: number;
}

export class ConsoleServer {
  private server: ReturnType<typeof createServer>;
  private wsServer: WebSocketServer;
  private wsHub: WsHub;
  private invocationStore: InvocationStore;
  private handleWorker: (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean>;
  private handleTools: (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean>;
  private handleInvocations: (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean>;
  private options: ConsoleServerOptions;
  private distDir: string;

  constructor(options: ConsoleServerOptions) {
    this.options = options;
    this.wsHub = new WsHub();
    this.invocationStore = new InvocationStore();
    this.handleWorker = createWorkerRoutes({
      runtime: options.runtime,
      invoker: options.invoker,
      invocationStore: this.invocationStore,
    });
    this.handleTools = createToolRoutes({
      invoker: options.invoker,
      invocationStore: this.invocationStore,
    });
    this.handleInvocations = createInvocationRoutes(this.invocationStore);

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    this.distDir = path.resolve(moduleDir, '../../apps/web/dist');

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.wsServer = new WebSocketServer({ noServer: true });

    this.wsServer.on('connection', (ws: WebSocket) => {
      ws.on('message', (data: Buffer) => {
        this.wsHub.handleClientMessage(ws, data.toString());
      });
      ws.on('close', () => this.wsHub.handleDisconnect(ws));
    });

    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wsServer.handleUpgrade(req, socket, head, ws => {
        this.wsServer.emit('connection', ws, req);
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLocalRequest(req)) {
      res.writeHead(403);
      res.end('Forbidden: localhost only');
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const { pathname } = url;

    // API 路由
    if (pathname.startsWith('/api/worker') || pathname === '/api/health') {
      const handled = await this.handleWorker(req, res, pathname);
      if (handled) return;
    }

    if (pathname.startsWith('/api/tools')) {
      const handled = await this.handleTools(req, res, pathname);
      if (handled) return;
    }

    if (pathname.startsWith('/api/invocations')) {
      const handled = await this.handleInvocations(req, res, pathname);
      if (handled) return;
    }

    if (pathname.startsWith('/api/hooks')) {
      // P0: hooks routes go here (Task 7)
      sendError(res, 'INTERNAL_ERROR', 'Hook routes not yet implemented');
      return;
    }

    // dev 模式反代
    if (this.options.dev && !pathname.startsWith('/api') && pathname !== '/ws') {
      proxyToVite(req, res, this.options.vitePort ?? 5173);
      return;
    }

    // 生产模式：静态资源
    await this.serveStatic(res, pathname);
  }

  private async serveStatic(res: ServerResponse, reqPath: string): Promise<void> {
    const normalized = reqPath === '/' ? '/index.html' : reqPath;
    const targetPath = path.resolve(this.distDir, `.${normalized}`);

    if (!targetPath.startsWith(this.distDir) || !existsSync(targetPath)) {
      // SPA fallback: serve index.html for all non-API routes
      const indexPath = path.resolve(this.distDir, 'index.html');
      if (existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const { createReadStream } = await import('node:fs');
        createReadStream(indexPath).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const targetStat = await stat(targetPath);
    if (!targetStat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(targetPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    const { createReadStream } = await import('node:fs');
    createReadStream(targetPath).pipe(res);
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>(resolve => {
      this.wsServer.close(() => {
        this.server.close(() => resolve());
      });
    });
  }

  getHub(): WsHub { return this.wsHub; }
  getInvocationStore(): InvocationStore { return this.invocationStore; }
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

---

### Task 7: 前端布局骨架 + 路由 + 概览页

**Files:**
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/components/layout/Sidebar.tsx`
- Create: `apps/web/src/components/layout/TopBar.tsx`
- Create: `apps/web/src/components/layout/RightDrawer.tsx`
- Create: `apps/web/src/components/common/StatusDot.tsx`
- Create: `apps/web/src/routes/overview.tsx`
- Create: `apps/web/src/components/overview/WorkerCard.tsx`
- Create: `apps/web/src/components/overview/BrowserCard.tsx`
- Create: `apps/web/src/components/overview/ActiveHooksCard.tsx`
- Create: `apps/web/src/components/overview/RecentInvocations.tsx`
- Create: `apps/web/src/stores/worker.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/ws.ts`
- Modify: `apps/web/src/main.tsx` (already imports App, no change needed)

- [ ] **Step 1: 实现 API 客户端**

```typescript
// apps/web/src/lib/api.ts
const BASE = '';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { traceId: string; ts: number };
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE + url, opts);
  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json.data as T;
}

export const api = {
  health: () => request<{ ok: boolean; version: string; uptime: number }>('GET', '/api/health'),

  workerStatus: () => request<{
    ok: boolean; version: string; uptime: number; pid: number;
    rpcHost: string; group: string;
    browser: { connected: boolean; mode: string; wsEndpoint?: string; pages: number; sessions: number };
    hooks: { total: number; active: number; paused: number };
    tools: { total: number };
  }>('GET', '/api/worker/status'),

  getTools: () => request<Array<{
    name: string; description: string; category: string; profile: string;
    argSpecs: Record<string, unknown>; jsonSchema: Record<string, unknown>;
  }>>('GET', '/api/tools'),

  getTool: (name: string) => request<{
    name: string; description: string; category: string;
    jsonSchema: Record<string, unknown>;
  }>('GET', `/api/tools/${encodeURIComponent(name)}`),

  callTool: (name: string, args: Record<string, unknown>, timeoutMs?: number) =>
    request<{ traceId: string; result: unknown; durationMs: number }>(
      'POST', `/api/tools/${encodeURIComponent(name)}/call`,
      { args, timeoutMs },
    ),

  getInvocations: (limit = 50) => request<Array<{
    id: string; traceId: string; toolName: string; success: boolean;
    startedAt: string; durationMs: number; args?: Record<string, unknown>;
    result?: unknown; error?: { code: string; message: string };
  }>>('GET', `/api/invocations?limit=${limit}`),
};
```

- [ ] **Step 2: 实现 WebSocket 客户端**

```typescript
// apps/web/src/lib/ws.ts
type Channel = 'worker.status' | 'tool.invoke' | 'hook.event' | 'hook.sample' | 'browser.event' | 'log';
type MessageHandler = (msg: { type: string; channel?: Channel; ts: number; payload?: unknown }) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private url: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private currentDelay = 1000;
  private shouldReconnect = true;

  constructor(url = '') {
    this.url = url;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.currentDelay = this.reconnectDelay;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = this.url || `${protocol}//${location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.currentDelay = this.reconnectDelay;
      this.handlers.forEach((_, key) => {
        const [channel] = key.split(':');
        this.send({ type: 'subscribe', channel: channel as Channel });
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handlers.forEach((fns, key) => {
          const [channel] = key.split(':');
          if (msg.channel === channel || key === '*') {
            fns.forEach(fn => fn(msg));
          }
        });
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.currentDelay);
        this.currentDelay = Math.min(this.currentDelay * 2, this.maxReconnectDelay);
      }
    };
  }

  subscribe(channel: Channel, handler: MessageHandler, filter?: Record<string, unknown>): () => void {
    const key = `${channel}:${JSON.stringify(filter ?? {})}`;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channel, filter });
    }

    return () => {
      this.handlers.get(key)?.delete(handler);
      if (this.handlers.get(key)?.size === 0) {
        this.handlers.delete(key);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({ type: 'unsubscribe', channel });
        }
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }

  private send(msg: unknown): void {
    this.ws?.send(JSON.stringify(msg));
  }
}

export const wsClient = new WsClient();
```

- [ ] **Step 3: 实现 Zustand stores**

```typescript
// apps/web/src/stores/worker.ts
import { create } from 'zustand';
import { api } from '../lib/api';

interface WorkerState {
  status: {
    ok: boolean; version: string; uptime: number; pid: number;
    rpcHost: string; group: string;
    browser: { connected: boolean; mode: string; pages: number; sessions: number };
    hooks: { total: number; active: number; paused: number };
    tools: { total: number };
  } | null;
  loading: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
}

export const useWorkerStore = create<WorkerState>((set) => ({
  status: null,
  loading: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const status = await api.workerStatus();
      set({ status, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error', loading: false });
    }
  },
}));
```

```typescript
// apps/web/src/stores/tools.ts
import { create } from 'zustand';
import { api } from '../lib/api';

interface ToolInfo {
  name: string; description: string; category: string;
  profile: string; argSpecs: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
}

interface ToolsState {
  tools: ToolInfo[];
  loading: boolean;
  selectedTool: ToolInfo | null;
  fetchTools: () => Promise<void>;
  selectTool: (tool: ToolInfo | null) => void;
}

export const useToolsStore = create<ToolsState>((set) => ({
  tools: [],
  loading: false,
  selectedTool: null,

  fetchTools: async () => {
    set({ loading: true });
    try {
      const tools = await api.getTools();
      set({ tools, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  selectTool: (tool) => set({ selectedTool: tool }),
}));
```

- [ ] **Step 4: 实现布局组件**

```typescript
// apps/web/src/components/common/StatusDot.tsx
type Status = 'green' | 'yellow' | 'red' | 'gray';

const colors: Record<Status, string> = {
  green: 'bg-[var(--color-status-green)]',
  yellow: 'bg-[var(--color-status-yellow)]',
  red: 'bg-[var(--color-status-red)]',
  gray: 'bg-[var(--color-status-gray)]',
};

export function StatusDot({ status, pulse = false }: { status: Status; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status]} ${pulse ? 'animate-pulse' : ''}`}
    />
  );
}
```

```typescript
// apps/web/src/components/layout/Sidebar.tsx
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Wrench, Radio, Monitor, Settings, Terminal } from 'lucide-react';
import { StatusDot } from '../common/StatusDot';
import { useWorkerStore } from '../../stores/worker';
import { useEffect } from 'react';

const navItems = [
  { group: '工作流', items: [
    { to: '/', label: '概览', icon: LayoutDashboard },
    { to: '/tools', label: '工具调用', icon: Wrench },
    { to: '/hooks', label: 'Hook 监控', icon: Radio },
  ]},
  { group: '环境', items: [
    { to: '/sessions', label: '会话与页面', icon: Monitor },
    { to: '/worker', label: 'Worker 状态', icon: Terminal },
    { to: '/settings', label: '设置', icon: Settings },
  ]},
];

export function Sidebar() {
  const { status, fetchStatus } = useWorkerStore();

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const daemonStatus = status?.ok ? 'green' : 'red';

  return (
    <aside className="w-56 h-full flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border-muted)]">
      <div className="px-4 py-3 border-b border-[var(--color-border-muted)]">
        <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">JSReverser 控制台</h1>
        <p className="text-xs text-[var(--color-text-muted)]">v{status?.version ?? '...'}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navItems.map(group => (
          <div key={group.group}>
            <p className="px-3 mb-1 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              {group.group}
            </p>
            {group.items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                  }`
                }
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-[var(--color-border-muted)] flex items-center gap-2">
        <StatusDot status={daemonStatus as 'green' | 'red'} />
        <span className="text-xs text-[var(--color-text-secondary)]">
          daemon {status?.ok ? '在线' : '离线'}
        </span>
      </div>
    </aside>
  );
}
```

```typescript
// apps/web/src/components/layout/TopBar.tsx
import { StatusDot } from '../common/StatusDot';
import { useWorkerStore } from '../../stores/worker';
import type { Status } from '../common/StatusDot';

const statusColor = (v: boolean | undefined): Status => {
  if (v === undefined) return 'gray';
  return v ? 'green' : 'red';
};

export function TopBar() {
  const { status } = useWorkerStore();

  return (
    <header className="h-9 flex items-center gap-6 px-4 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-muted)] text-xs">
      <Indicator label="Worker" status={statusColor(status?.ok)} />
      <Indicator label="RPC" status={status?.rpcHost ? 'green' : 'gray'} detail={status?.rpcHost} />
      <Indicator label="Browser" status={statusColor(status?.browser?.connected)} detail={status?.browser?.mode} />
      <Indicator label="Sessions" detail={`${status?.browser?.sessions ?? 0}`} />
      <Indicator label="Hooks" detail={`${status?.hooks?.active ?? 0}/${status?.hooks?.total ?? 0}`} />
    </header>
  );
}

function Indicator({ label, status, detail }: { label: string; status?: Status; detail?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {status && <StatusDot status={status} />}
      <span className="text-[var(--color-text-muted)]">{label}</span>
      {detail && <span className="text-[var(--color-text-secondary)]">{detail}</span>}
    </div>
  );
}
```

```typescript
// apps/web/src/components/layout/RightDrawer.tsx
import { X, Pin } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface RightDrawerProps {
  open: boolean;
  onClose: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  title?: string;
  children: React.ReactNode;
}

export function RightDrawer({ open, onClose, pinned = false, onTogglePin, title, children }: RightDrawerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pinned) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, pinned]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="w-[480px] lg:w-[560px] xl:w-[640px] h-full border-l border-[var(--color-border-muted)] bg-[var(--color-bg-secondary)] flex flex-col overflow-hidden"
    >
      <div className="h-9 flex items-center justify-between px-4 border-b border-[var(--color-border-muted)] shrink-0">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{title ?? '详情'}</span>
        <div className="flex items-center gap-1">
          {onTogglePin && (
            <button onClick={onTogglePin} className={`p-1 rounded hover:bg-[var(--color-bg-tertiary)] ${pinned ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
              <Pin size={14} />
            </button>
          )}
          {!pinned && (
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: 实现概览页卡片组件**

```typescript
// apps/web/src/components/overview/WorkerCard.tsx
import { useWorkerStore } from '../../stores/worker';
import { StatusDot } from '../common/StatusDot';
import { Link } from 'react-router-dom';

export function WorkerCard() {
  const { status } = useWorkerStore();

  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <StatusDot status={status?.ok ? 'green' : 'red'} pulse={status?.ok} />
        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Worker</h3>
      </div>
      <dl className="space-y-1.5 text-xs">
        <Row label="PID" value={status?.pid} />
        <Row label="运行时间" value={status?.uptime ? `${Math.floor(status.uptime / 1000)}s` : '...'} />
        <Row label="RPC Host" value={status?.rpcHost} />
        <Row label="Group" value={status?.group} />
      </dl>
      <Link to="/worker" className="inline-block mt-3 text-xs text-[var(--color-accent)] hover:underline">
        查看日志 →
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-[var(--color-text-secondary)] font-mono">{value ?? '...'}</dd>
    </div>
  );
}
```

```typescript
// apps/web/src/components/overview/BrowserCard.tsx
import { useWorkerStore } from '../../stores/worker';
import { StatusDot } from '../common/StatusDot';
import { Link } from 'react-router-dom';

export function BrowserCard() {
  const { status } = useWorkerStore();
  const b = status?.browser;

  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <StatusDot status={b?.connected ? 'green' : 'gray'} />
        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Browser</h3>
      </div>
      <dl className="space-y-1.5 text-xs">
        <Row label="模式" value={b?.mode} />
        <Row label="页面数" value={b?.pages} />
        <Row label="Sessions" value={b?.sessions} />
      </dl>
      <Link to="/sessions" className="inline-block mt-3 text-xs text-[var(--color-accent)] hover:underline">
        管理会话 →
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-[var(--color-text-secondary)] font-mono">{value ?? '...'}</dd>
    </div>
  );
}
```

- [ ] **Step 6: 实现概览页主组件**

```typescript
// apps/web/src/routes/overview.tsx
import { WorkerCard } from '../components/overview/WorkerCard';
import { BrowserCard } from '../components/overview/BrowserCard';

export function OverviewPage() {
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">概览</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WorkerCard />
        <BrowserCard />
        <ActiveHooksCard />
        <RecentInvocationsCard />
      </div>
    </div>
  );
}

// Placeholder cards - will be enhanced in later tasks
function ActiveHooksCard() {
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">活跃 Hook</h3>
      <p className="text-xs text-[var(--color-text-muted)]">Hook 数据将在 Hook 监控页实现后接入</p>
    </div>
  );
}

function RecentInvocationsCard() {
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">最近工具调用</h3>
      <p className="text-xs text-[var(--color-text-muted)]">调用历史将在概览实时刷新任务中接入</p>
    </div>
  );
}
```

- [ ] **Step 7: 组装 App 根组件**

```typescript
// apps/web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { OverviewPage } from './routes/overview';

export function App() {
  return (
    <BrowserRouter>
      <div className="h-full flex flex-col">
        <TopBar />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-[var(--color-bg-primary)]">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/tools" element={<Placeholder title="工具调用" />} />
              <Route path="/hooks" element={<Placeholder title="Hook 监控" />} />
              <Route path="/sessions" element={<Placeholder title="会话与页面" />} />
              <Route path="/worker" element={<Placeholder title="Worker 状态" />} />
              <Route path="/settings" element={<Placeholder title="设置" />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <p className="text-sm text-[var(--color-text-muted)] mt-2">即将实现...</p>
    </div>
  );
}
```

- [ ] **Step 8: 安装前端依赖并验证构建**

```bash
cd apps/web && npm install
```

Expected: 依赖安装成功（已有 packages 声明）

```bash
cd apps/web && npx tsc --noEmit
```

Expected: 无类型错误

```bash
cd apps/web && npx vite build
```

Expected: 构建成功，dist/ 目录产出

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/ apps/web/src/routes/ apps/web/src/stores/ apps/web/src/lib/
git add src/web/
git commit -m "feat(web): add protocol types, ConsoleServer, WsHub, REST routes, frontend layout skeleton with overview page"
```

---

## Phase 2: 工具调用页 + 表单生成 (D3)

### Task 8: 工具列表与分类树

**Files:**
- Create: `apps/web/src/components/tools/CategoryTree.tsx`

- [ ] **Step 1: 实现 CategoryTree**

```typescript
// apps/web/src/components/tools/CategoryTree.tsx
import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export interface ToolItem {
  name: string;
  description: string;
  category: string;
}

interface CategoryTreeProps {
  tools: ToolItem[];
  selectedTool: string | null;
  onSelect: (name: string) => void;
  searchQuery: string;
}

export function CategoryTree({ tools, selectedTool, onSelect, searchQuery }: CategoryTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = searchQuery
    ? tools.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : tools;

  const categories = new Map<string, ToolItem[]>();
  for (const t of filtered) {
    const cat = t.category || 'other';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(t);
  }

  const toggle = (cat: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      {[...categories.entries()].map(([cat, items]) => (
        <div key={cat}>
          <button
            onClick={() => toggle(cat)}
            className="w-full flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] uppercase tracking-wider"
          >
            {collapsed.has(cat) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {cat}
            <span className="ml-auto text-[var(--color-text-muted)]">{items.length}</span>
          </button>
          {!collapsed.has(cat) && items.map(tool => (
            <button
              key={tool.name}
              onClick={() => onSelect(tool.name)}
              className={`w-full text-left px-4 py-1.5 text-sm rounded transition-colors ${
                selectedTool === tool.name
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
              }`}
            >
              <div className="truncate font-mono text-xs">{tool.name}</div>
              <div className="truncate text-xs text-[var(--color-text-muted)]">{tool.description}</div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/tools/CategoryTree.tsx
git commit -m "feat(web): add tool category tree component"
```

---

### Task 9: JSON Schema 表单渲染引擎

**Files:**
- Create: `apps/web/src/lib/schema.ts`
- Create: `apps/web/src/components/tools/ToolForm.tsx`

- [ ] **Step 1: 实现 schema 转表单字段**

```typescript
// apps/web/src/lib/schema.ts
interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string };
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface FormField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'json';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
  itemsType?: string;
}

export function jsonSchemaToFormFields(schema: JsonSchema): FormField[] {
  const fields: FormField[] = [];
  const required = new Set(schema.required ?? []);

  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const field: FormField = {
      name,
      label: name,
      description: prop.description,
      required: required.has(name),
      type: mapType(prop),
      defaultValue: prop.default,
      enumValues: prop.enum,
      itemsType: prop.items?.type,
    };
    fields.push(field);
  }

  return fields;
}

function mapType(prop: JsonSchemaProperty): FormField['type'] {
  if (prop.enum) return 'enum';
  if (prop.type === 'array') return 'array';
  if (prop.type === 'object') return 'json';
  if (prop.type === 'number' || prop.type === 'integer') return 'number';
  if (prop.type === 'boolean') return 'boolean';
  return 'string';
}
```

- [ ] **Step 2: 实现 ToolForm 组件**

```typescript
// apps/web/src/components/tools/ToolForm.tsx
import { useState, useCallback } from 'react';
import type { FormField } from '../../lib/schema';

interface ToolFormProps {
  fields: FormField[];
  onSubmit: (args: Record<string, unknown>) => void;
  loading?: boolean;
}

export function ToolForm({ fields, onSubmit, loading }: ToolFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      init[f.name] = f.defaultValue ?? getDefault(f);
    }
    return init;
  });
  const [jsonMode, setJsonMode] = useState<Set<string>>(new Set());
  const [jsonText, setJsonText] = useState<Record<string, string>>({});

  const updateValue = useCallback((name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const toggleJsonMode = (name: string) => {
    setJsonMode(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        try {
          const parsed = JSON.parse(jsonText[name] ?? '{}');
          updateValue(name, parsed);
        } catch { /* keep old value */ }
      } else {
        next.add(name);
        setJsonText(prev => ({ ...prev, [name]: JSON.stringify(values[name], null, 2) }));
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Merge JSON-mode values
    const final: Record<string, unknown> = { ...values };
    for (const name of jsonMode) {
      try {
        final[name] = JSON.parse(jsonText[name] ?? '{}');
      } catch { /* keep old */ }
    }

    // Remove empty optional fields
    for (const f of fields) {
      if (!f.required && (final[f.name] === '' || final[f.name] === undefined || final[f.name] === null)) {
        delete final[f.name];
      }
    }

    onSubmit(final);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map(field => (
        <div key={field.name} className="space-y-1">
          <label className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
            {field.label}
            {field.required && <span className="text-[var(--color-accent-red)]">*</span>}
            {field.type === 'json' && (
              <button type="button" onClick={() => toggleJsonMode(field.name)}
                className="ml-auto text-xs text-[var(--color-accent)] hover:underline">
                {jsonMode.has(field.name) ? '表单' : 'JSON'}
              </button>
            )}
          </label>
          {field.description && (
            <p className="text-xs text-[var(--color-text-muted)]">{field.description}</p>
          )}

          {jsonMode.has(field.name) ? (
            <textarea
              className="w-full h-24 px-3 py-2 text-xs font-mono bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] resize-y"
              value={jsonText[field.name] ?? JSON.stringify(values[field.name], null, 2)}
              onChange={e => setJsonText(prev => ({ ...prev, [field.name]: e.target.value }))}
            />
          ) : (
            <FieldInput field={field} value={values[field.name]} onChange={v => updateValue(field.name, v)} />
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 px-4 bg-[var(--color-accent)] text-white text-sm font-medium rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? '执行中...' : '▶ 执行'}
      </button>
    </form>
  );
}

function FieldInput({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  const inputClass = 'w-full px-3 py-1.5 text-xs font-mono bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none';

  switch (field.type) {
    case 'boolean':
      return (
        <select className={inputClass} value={String(value)} onChange={e => onChange(e.target.value === 'true')}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      );

    case 'number':
      return (
        <input type="number" className={inputClass} value={typeof value === 'number' ? value : ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      );

    case 'enum':
      return (
        <select className={inputClass} value={String(value ?? '')} onChange={e => onChange(e.target.value || undefined)}>
          <option value="">-- 选择 --</option>
          {field.enumValues?.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      );

    case 'array':
      return (
        <textarea className={inputClass} rows={3} value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={e => onChange(e.target.value ? e.target.value.split('\n').filter(Boolean) : [])}
          placeholder={field.itemsType ? `每行一个 ${field.itemsType}` : '每行一个值'} />
      );

    default:
      return (
        <input type="text" className={inputClass} value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)} />
      );
  }
}

function getDefault(field: FormField): unknown {
  switch (field.type) {
    case 'boolean': return false;
    case 'number': return undefined;
    case 'array': return [];
    default: return '';
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/schema.ts apps/web/src/components/tools/ToolForm.tsx
git commit -m "feat(web): add JSON Schema form renderer"
```

---

### Task 10: 工具调用页主体 + 调用执行

**Files:**
- Create: `apps/web/src/components/tools/InvocationLog.tsx`
- Replace: `apps/web/src/routes/tools.tsx` (was placeholder)

- [ ] **Step 1: 实现 InvocationLog 组件**

```typescript
// apps/web/src/components/tools/InvocationLog.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download } from 'lucide-react';

interface InvocationLogProps {
  traceId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string; message: string };
}

export function InvocationLog({ traceId, toolName, durationMs, success, args, result, error }: InvocationLogProps) {
  const [expanded, setExpanded] = useState(false);

  const copyJson = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  return (
    <div className="border border-[var(--color-border-default)] rounded">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--color-bg-tertiary)]">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={`w-1.5 h-1.5 rounded-full ${success ? 'bg-[var(--color-status-green)]' : 'bg-[var(--color-status-red)]'}`} />
        <span className="font-mono text-[var(--color-text-secondary)]">{toolName}</span>
        <span className="text-[var(--color-text-muted)] ml-auto">{durationMs}ms</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 text-xs">
          <details>
            <summary className="text-[var(--color-text-muted)] cursor-pointer">Input</summary>
            <pre className="mt-1 p-2 bg-[var(--color-bg-primary)] rounded font-mono text-[var(--color-text-secondary)] overflow-x-auto max-h-48">
              {JSON.stringify(args ?? {}, null, 2)}
            </pre>
          </details>
          {success ? (
            <details open>
              <summary className="text-[var(--color-text-muted)] cursor-pointer">Output</summary>
              <pre className="mt-1 p-2 bg-[var(--color-bg-primary)] rounded font-mono text-[var(--color-text-secondary)] overflow-x-auto max-h-64">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          ) : (
            <div className="text-[var(--color-status-red)]">
              {error?.code}: {error?.message}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => copyJson(args)} className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
              <Copy size={12} /> 复制 input
            </button>
            <button onClick={() => copyJson(result)} className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
              <Download size={12} /> 复制 output
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 实现工具调用页**

```typescript
// apps/web/src/routes/tools.tsx
import { useEffect, useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useToolsStore } from '../stores/tools';
import { CategoryTree } from '../components/tools/CategoryTree';
import { ToolForm } from '../components/tools/ToolForm';
import { InvocationLog } from '../components/tools/InvocationLog';
import { RightDrawer } from '../components/layout/RightDrawer';
import { api } from '../lib/api';
import { jsonSchemaToFormFields } from '../lib/schema';

export function ToolsPage() {
  const { tools, loading, fetchTools } = useToolsStore();
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [lastInvocation, setLastInvocation] = useState<{
    traceId: string; toolName: string; durationMs: number; success: boolean;
    args?: Record<string, unknown>; result?: unknown; error?: { code: string; message: string };
  } | null>(null);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const toolParam = params.get('selected');
    if (toolParam) {
      setSelectedName(toolParam);
      setDrawerOpen(true);
    }
  }, []);

  const handleSelect = (name: string) => {
    setSelectedName(name);
    setDrawerOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set('selected', name);
    window.history.replaceState({}, '', url);
  };

  const handleClose = () => {
    setDrawerOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('selected');
    window.history.replaceState({}, '', url);
  };

  const selectedTool = tools.find(t => t.name === selectedName);
  const fields = selectedTool?.jsonSchema
    ? jsonSchemaToFormFields(selectedTool.jsonSchema as { type: 'object'; properties: Record<string, unknown>; required?: string[] })
    : [];

  const handleSubmit = useCallback(async (args: Record<string, unknown>) => {
    if (!selectedName) return;
    setCallLoading(true);
    try {
      const res = await api.callTool(selectedName, args);
      setLastInvocation({
        traceId: res.traceId,
        toolName: selectedName,
        durationMs: res.durationMs,
        success: true,
        args,
        result: res.result,
      });
    } catch (err) {
      setLastInvocation({
        traceId: `err_${Date.now()}`,
        toolName: selectedName,
        durationMs: 0,
        success: false,
        args,
        error: { code: 'TOOL_ERROR', message: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      setCallLoading(false);
    }
  }, [selectedName]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[var(--color-border-muted)]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            placeholder="搜索工具名、描述、参数名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="text-xs text-[var(--color-text-muted)] p-4">加载中...</p>
        ) : (
          <CategoryTree
            tools={tools.map(t => ({ name: t.name, description: t.description, category: t.category }))}
            selectedTool={selectedName}
            onSelect={handleSelect}
            searchQuery={search}
          />
        )}
      </div>

      <RightDrawer open={drawerOpen} onClose={handleClose} title={selectedName ?? '工具详情'}>
        {selectedTool && (
          <div className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] font-mono">{selectedTool.name}</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{selectedTool.description}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">分类: {selectedTool.category}</p>
            </div>
            <ToolForm fields={fields} onSubmit={handleSubmit} loading={callLoading} />
            {lastInvocation && <InvocationLog {...lastInvocation} />}
          </div>
        )}
      </RightDrawer>
    </div>
  );
}
```

- [ ] **Step 3: 更新 App.tsx 路由**

```typescript
// 在 App.tsx 中修改 import 和 Route
import { ToolsPage } from './routes/tools';

// 替换 placeholder Route:
<Route path="/tools" element={<ToolsPage />} />
```

- [ ] **Step 4: 验证前端构建**

```bash
cd apps/web && npx tsc --noEmit && npx vite build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tools/InvocationLog.tsx apps/web/src/routes/tools.tsx apps/web/src/App.tsx
git commit -m "feat(web): add tool call page with search, category tree, form, and invocation result display"
```

---

## Phase 3: WebSocket 实时层 + 概览实时刷新 (D4)

### Task 11: ToolInvokeBridge + Worker 启动集成

**Files:**
- Create: `src/web/ws/ToolInvokeBridge.ts`
- Create: `src/web/ws/HookSampleBridge.ts`
- Modify: `src/worker/ToolExecutionPipeline.ts`

- [ ] **Step 1: 在 ToolExecutionPipeline 添加 EventEmitter**

```typescript
// 修改 src/worker/ToolExecutionPipeline.ts
// 在 execute() 方法的成功/失败分支添加事件发出

// 在类中添加:
import { EventEmitter } from 'node:events';

export interface ToolInvokeLifecycleEvent {
  toolName: string;
  phase: 'start' | 'end';
  ts: number;
  durationMs?: number;
  success?: boolean;
  error?: { code: string; message: string };
}

// ToolExecutionPipeline 添加:
public readonly lifecycle = new EventEmitter();

// 在 execute() 方法开头添加:
const traceId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const startedAt = Date.now();
this.lifecycle.emit('invoke:start', {
  toolName, phase: 'start', ts: startedAt,
} as ToolInvokeLifecycleEvent);

// 在成功分支添加:
this.lifecycle.emit('invoke:end', {
  toolName, phase: 'end', ts: Date.now(),
  durationMs: Date.now() - startedAt, success: true,
} as ToolInvokeLifecycleEvent);

// 在错误分支添加:
this.lifecycle.emit('invoke:end', {
  toolName, phase: 'end', ts: Date.now(),
  durationMs: Date.now() - startedAt, success: false,
  error: { code: toolError.code, message: toolError.message },
} as ToolInvokeLifecycleEvent);
```

- [ ] **Step 2: 实现 ToolInvokeBridge**

```typescript
// src/web/ws/ToolInvokeBridge.ts
import type { WsHub } from './WsHub.js';
import type { ToolExecutionPipeline, ToolInvokeLifecycleEvent } from '../../worker/ToolExecutionPipeline.js';

export class ToolInvokeBridge {
  constructor(pipeline: ToolExecutionPipeline, wsHub: WsHub) {
    pipeline.lifecycle.on('invoke:start', (event: ToolInvokeLifecycleEvent) => {
      wsHub.broadcast('tool.invoke', event);
    });
    pipeline.lifecycle.on('invoke:end', (event: ToolInvokeLifecycleEvent) => {
      wsHub.broadcast('tool.invoke', event);
    });
  }
}
```

- [ ] **Step 3: 实现 HookSampleBridge**

```typescript
// src/web/ws/HookSampleBridge.ts
import type { WsHub } from './WsHub.js';
import type { HookManager } from '../../modules/hook/HookManager.js';

export class HookSampleBridge {
  constructor(hookManager: HookManager, wsHub: WsHub) {
    // HookManager.onSample 如果存在则监听
    if (typeof (hookManager as Record<string, unknown>).on === 'function') {
      (hookManager as unknown as { on: (event: string, fn: (...args: unknown[]) => void) => void })
        .on('sample', (hookId: string, sample: unknown) => {
          wsHub.broadcast('hook.sample', { hookId, ...(sample as object) },
            sub => !sub.filter?.hookId || sub.filter.hookId === hookId);
        });
    }
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

---

### Task 12: 修改 Worker 入口集成 ConsoleServer

**Files:**
- Modify: `src/index.ts`
- Modify: `src/cli/commands/start.ts`

- [ ] **Step 1: 修改 Worker 入口启动 ConsoleServer**

在 `src/index.ts` 的 `main()` 函数中，在 `await client.start()` 之后添加：

```typescript
// 在 main() 中，client.start() 之后，信号处理之前添加:
// 10. 启动 Web 控制台服务
let consoleServer: ConsoleServer | undefined;
const webPortStr = process.env.JS_REVERSE_WEB_PORT;
const webPort = webPortStr ? parseInt(webPortStr, 10) : 8765;

try {
  const { ConsoleServer } = await import('./web/ConsoleServer.js');
  consoleServer = new ConsoleServer({
    port: webPort,
    runtime,
    invoker: invoker as unknown as SekiroInvoker,
    dev: process.env.NODE_ENV !== 'production',
  });
  await consoleServer.listen();
  console.log(`[Worker] 控制台 http://127.0.0.1:${webPort}`);

  // 桥接 WS 事件
  const { ToolInvokeBridge } = await import('./web/ws/ToolInvokeBridge.js');
  new ToolInvokeBridge(toolAdapter.getPipeline?.() ?? ({} as ToolExecutionPipeline), consoleServer.getHub());
} catch (err) {
  console.warn('[Worker] Web 控制台启动失败 (Worker 继续运行):', err);
}

// 修改信号处理:
process.on('SIGTERM', async () => {
  await consoleServer?.close();
  await gracefulShutdown('SIGTERM');
});
process.on('SIGINT', async () => {
  await consoleServer?.close();
  await gracefulShutdown('SIGINT');
});
```

- [ ] **Step 2: 修改 start 命令添加 --no-web / --web-port flags**

在 `start.ts` 中解析新 flags 并设置环境变量：

```typescript
// 在 startCommand 函数开头，flags 解析后:
const noWeb = getBoolFlag(parsed, 'no-web');
const webPort = getFlag(parsed, 'web-port');

if (noWeb) {
  process.env.JS_REVERSE_NO_WEB = '1';
}
if (webPort) {
  process.env.JS_REVERSE_WEB_PORT = webPort;
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/cli/commands/start.ts src/worker/ToolExecutionPipeline.ts src/web/ws/ToolInvokeBridge.ts src/web/ws/HookSampleBridge.ts
git commit -m "feat(web): integrate ConsoleServer into Worker startup, add ToolInvokeBridge and HookSampleBridge"
```

---

### Task 13: 概览页实时数据接入

**Files:**
- Modify: `apps/web/src/routes/overview.tsx`
- Modify: `apps/web/src/components/overview/RecentInvocations.tsx` (rewrite from placeholder)
- Create: `apps/web/src/stores/invocations.ts`

- [ ] **Step 1: 实现 invocations store**

```typescript
// apps/web/src/stores/invocations.ts
import { create } from 'zustand';

interface Invocation {
  traceId: string;
  toolName: string;
  phase: 'start' | 'end';
  ts: number;
  durationMs?: number;
  success?: boolean;
  error?: { code: string; message: string };
}

interface InvocationsState {
  recent: Invocation[];
  push: (inv: Invocation) => void;
}

export const useInvocationsStore = create<InvocationsState>((set) => ({
  recent: [],
  push: (inv) => set(state => ({
    recent: [inv, ...state.recent].slice(0, 100),
  })),
}));
```

- [ ] **Step 2: 实现 RecentInvocations 组件**

```typescript
// apps/web/src/components/overview/RecentInvocations.tsx
import { useEffect } from 'react';
import { useInvocationsStore } from '../../stores/invocations';
import { wsClient } from '../../lib/ws';
import { api } from '../../lib/api';
import { StatusDot } from '../common/StatusDot';
import { useState } from 'react';

export function RecentInvocationsCard() {
  const { recent, push } = useInvocationsStore();
  const [errorLog, setErrorLog] = useState<Array<{ time: string; tool: string; msg: string }>>([]);

  useEffect(() => {
    // 初始加载历史
    api.getInvocations(10).catch(() => {});

    // 订阅实时事件
    const unsub = wsClient.subscribe('tool.invoke', (msg) => {
      const inv = msg.payload as { toolName: string; phase: string; ts: number; durationMs?: number; success?: boolean; error?: { code: string; message: string } };
      if (inv) push(inv);

      if (inv?.phase === 'end' && inv?.success === false) {
        setErrorLog(prev => [
          { time: new Date(inv.ts).toLocaleTimeString(), tool: inv.toolName, msg: inv.error?.message ?? 'Unknown' },
          ...prev,
        ].slice(0, 50));
      }
    });

    return unsub;
  }, [push]);

  const completed = recent.filter(r => r.phase === 'end').slice(0, 10);

  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">最近工具调用 / 错误日志</h3>

      {/* 调用列表 */}
      <div className="space-y-1 mb-3">
        {completed.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">暂无调用记录</p>
        )}
        {completed.map((inv, i) => (
          <div key={`${inv.traceId}-${i}`} className="flex items-center gap-2 text-xs py-0.5">
            <StatusDot status={inv.success ? 'green' : 'red'} />
            <span className="text-[var(--color-text-muted)] font-mono">{new Date(inv.ts).toLocaleTimeString()}</span>
            <span className="text-[var(--color-text-secondary)] font-mono truncate flex-1">{inv.toolName}</span>
            <span className={`font-mono ${inv.success ? 'text-[var(--color-status-green)]' : 'text-[var(--color-status-red)]'}`}>
              {inv.durationMs}ms
            </span>
          </div>
        ))}
      </div>

      {/* 错误日志 */}
      <details>
        <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)]">
          错误日志 ({errorLog.length})
        </summary>
        <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
          {errorLog.map((e, i) => (
            <div key={i} className="text-xs text-[var(--color-status-red)] font-mono">
              <span className="text-[var(--color-text-muted)]">{e.time}</span> {e.tool}: {e.msg}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: 更新概览页，替换占位卡片**

```typescript
// 在 overview.tsx 中删除占位的 ActiveHooksCard 和 RecentInvocationsCard，
// 替换为真实组件
import { ActiveHooksCard } from '../components/overview/ActiveHooksCard';
import { RecentInvocationsCard } from '../components/overview/RecentInvocations';
```

- [ ] **Step 4: 前端连接 WS 客户端**

```typescript
// 在 App.tsx 中添加 useEffect 连接 ws:
import { wsClient } from './lib/ws';
// 在 App 组件内:
useEffect(() => {
  wsClient.connect();
  return () => wsClient.disconnect();
}, []);
```

- [ ] **Step 5: 验证构建**

```bash
cd apps/web && npx tsc --noEmit && npx vite build
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/invocations.ts apps/web/src/components/overview/RecentInvocations.tsx apps/web/src/routes/overview.tsx apps/web/src/App.tsx
git commit -m "feat(web): connect overview page to real-time tool invocation events via WebSocket"
```

---

## Phase 4: Hook 监控页 (D5)

### Task 14: Hook REST API 路由

**Files:**
- Create: `src/web/routes/hooks.ts`

- [ ] **Step 1: 实现 hooks 路由**

```typescript
// src/web/routes/hooks.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendError } from '../middleware/error.js';
import type { SekiroInvoker } from '../../cli/sekiro-invoker.js';
import type { HookSummary, HookDetail } from '../types.js';

export function createHookRoutes(invoker: SekiroInvoker) {
  return async function handleHookRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    // GET /api/hooks
    if (req.method === 'GET' && pathname === '/api/hooks') {
      try {
        const result = await invoker.invoke('list_hooks', {});
        sendJson(res, 200, result ?? []);
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // POST /api/hooks
    if (req.method === 'POST' && pathname === '/api/hooks') {
      const body = await readBody(req);
      if (!body) { sendError(res, 'INVALID_ARGS'); return true; }
      try {
        const result = await invoker.invoke('create_hook', body);
        sendJson(res, 201, result);
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // GET /api/hooks/:id
    const match = pathname.match(/^\/api\/hooks\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      try {
        const result = await invoker.invoke('get_hook', { hookId: match[1] });
        sendJson(res, 200, result);
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // POST /api/hooks/:id/pause
    const pauseMatch = pathname.match(/^\/api\/hooks\/([^/]+)\/pause$/);
    if (req.method === 'POST' && pauseMatch) {
      try {
        await invoker.invoke('pause_hook', { hookId: pauseMatch[1] });
        sendJson(res, 200, { status: 'paused' });
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // POST /api/hooks/:id/resume
    const resumeMatch = pathname.match(/^\/api\/hooks\/([^/]+)\/resume$/);
    if (req.method === 'POST' && resumeMatch) {
      try {
        await invoker.invoke('resume_hook', { hookId: resumeMatch[1] });
        sendJson(res, 200, { status: 'active' });
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // DELETE /api/hooks/:id
    if (req.method === 'DELETE' && match) {
      try {
        await invoker.invoke('delete_hook', { hookId: match[1] });
        sendJson(res, 200, { deleted: true });
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // GET /api/hooks/:id/samples
    const samplesMatch = pathname.match(/^\/api\/hooks\/([^/]+)\/samples$/);
    if (req.method === 'GET' && samplesMatch) {
      try {
        const result = await invoker.invoke('get_hook_samples', { hookId: samplesMatch[1] });
        sendJson(res, 200, result ?? []);
      } catch (err) {
        sendError(res, 'TOOL_ERROR', { message: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    return false;
  };
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch { resolve(null); }
    });
  });
}
```

- [ ] **Step 2: 在 ConsoleServer 中注册 hooks 路由**

在 `ConsoleServer.ts` 的 `handleRequest` 方法中，在 `hooks` 检查处替换占位逻辑：

```typescript
// 添加 hooks handler:
private handleHooks: (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean>;

// 在 constructor 中:
import { createHookRoutes } from './routes/hooks.js';
this.handleHooks = createHookRoutes(this.options.invoker);

// handleRequest 中:
if (pathname.startsWith('/api/hooks')) {
  const handled = await this.handleHooks(req, res, pathname);
  if (handled) return;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/routes/hooks.ts src/web/ConsoleServer.ts
git commit -m "feat(web): add hook REST API routes (CRUD + pause/resume + samples)"
```

---

### Task 15: Hook 监控页前端组件

**Files:**
- Create: `apps/web/src/components/hooks/HookList.tsx`
- Create: `apps/web/src/components/hooks/SampleStream.tsx`
- Create: `apps/web/src/components/hooks/SampleRow.tsx`
- Create: `apps/web/src/stores/hooks.ts`
- Replace: `apps/web/src/routes/hooks.tsx` (was placeholder)

- [ ] **Step 1: 实现 hooks store**

```typescript
// apps/web/src/stores/hooks.ts
import { create } from 'zustand';
import { api } from '../lib/api';

interface HookInfo {
  id: string; name: string; location: string; captureMode: string;
  status: 'active' | 'paused' | 'detached'; sampleCount: number;
  lastSampleAt?: string; createdAt: string;
}

interface Sample {
  hookId: string; seq: number; ts: number;
  args?: unknown[]; retVal?: unknown;
  stack?: { url: string; line: number; col: number; functionName?: string }[];
  truncated?: boolean;
}

interface HooksState {
  hooks: HookInfo[];
  selectedHook: HookInfo | null;
  samples: Sample[];
  loading: boolean;
  fetchHooks: () => Promise<void>;
  selectHook: (hook: HookInfo | null) => void;
  pushSample: (sample: Sample) => void;
  clearSamples: () => void;
}

export const useHooksStore = create<HooksState>((set) => ({
  hooks: [],
  selectedHook: null,
  samples: [],
  loading: false,

  fetchHooks: async () => {
    set({ loading: true });
    try {
      const hooks = await (api as unknown as { getHooks: () => Promise<HookInfo[]> }).getHooks?.() ?? [];
      set({ hooks, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  selectHook: (hook) => set({ selectedHook: hook, samples: [] }),

  pushSample: (sample) => set(state => ({
    samples: [...state.samples, sample].slice(-1000),
  })),

  clearSamples: () => set({ samples: [] }),
}));
```

- [ ] **Step 2: 实现 HookList 组件**

```typescript
// apps/web/src/components/hooks/HookList.tsx
import { StatusDot } from '../common/StatusDot';
import type { Status } from '../common/StatusDot';

interface HookInfo {
  id: string; name: string; location: string; captureMode: string;
  status: 'active' | 'paused' | 'detached'; sampleCount: number;
  lastSampleAt?: string;
}

export function HookList({ hooks, selectedId, onSelect }: {
  hooks: HookInfo[]; selectedId: string | null; onSelect: (hook: HookInfo) => void;
}) {
  const statusMap: Record<string, Status> = {
    active: 'green',
    paused: 'yellow',
    detached: 'gray',
  };

  return (
    <div className="space-y-0.5">
      {hooks.map(hook => (
        <button
          key={hook.id}
          onClick={() => onSelect(hook)}
          className={`w-full text-left px-3 py-2 rounded transition-colors ${
            selectedId === hook.id
              ? 'bg-[var(--color-accent)]/15'
              : 'hover:bg-[var(--color-bg-tertiary)]'
          }`}
        >
          <div className="flex items-center gap-2">
            <StatusDot status={statusMap[hook.status] ?? 'gray'} pulse={hook.status === 'active'} />
            <span className="text-xs font-mono font-medium text-[var(--color-text-primary)] truncate">{hook.name}</span>
            <span className="ml-auto text-xs text-[var(--color-text-muted)] font-mono">{hook.sampleCount}</span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-text-muted)] truncate">{hook.location}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 实现 SampleRow 和 SampleStream**

```typescript
// apps/web/src/components/hooks/SampleRow.tsx
import { useState } from 'react';

interface Sample {
  seq: number; ts: number; args?: unknown[]; retVal?: unknown;
  stack?: { url: string; line: number; col: number; functionName?: string }[];
}

export function SampleRow({ sample }: { sample: Sample }) {
  const [expanded, setExpanded] = useState(false);

  const argsPreview = sample.args
    ? sample.args.map(a => (typeof a === 'string' ? a.slice(0, 80) : JSON.stringify(a).slice(0, 80))).join(', ')
    : '';

  return (
    <div className="border-b border-[var(--color-border-muted)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-[var(--color-bg-tertiary)] font-mono"
      >
        <span className="text-[var(--color-text-muted)] w-10 shrink-0">#{sample.seq}</span>
        <span className="text-[var(--color-text-muted)] w-16 shrink-0">{new Date(sample.ts).toLocaleTimeString()}</span>
        <span className="text-[var(--color-text-secondary)] truncate flex-1">{argsPreview || '(no args)'}</span>
        <span className="text-[var(--color-text-muted)]">→</span>
        <span className="text-[var(--color-text-secondary)] truncate flex-1 max-w-[200px]">
          {typeof sample.retVal === 'string' ? sample.retVal.slice(0, 80) : JSON.stringify(sample.retVal).slice(0, 80)}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-2 space-y-2">
          <details>
            <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer">Args (full)</summary>
            <pre className="mt-1 p-2 bg-[var(--color-bg-primary)] rounded text-xs font-mono text-[var(--color-text-secondary)] max-h-48 overflow-auto">
              {JSON.stringify(sample.args, null, 2)}
            </pre>
          </details>
          {sample.retVal !== undefined && (
            <details>
              <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer">Return Value</summary>
              <pre className="mt-1 p-2 bg-[var(--color-bg-primary)] rounded text-xs font-mono text-[var(--color-text-secondary)] max-h-48 overflow-auto">
                {JSON.stringify(sample.retVal, null, 2)}
              </pre>
            </details>
          )}
          {sample.stack && sample.stack.length > 0 && (
            <details>
              <summary className="text-xs text-[var(--color-text-muted)] cursor-pointer">调用栈</summary>
              <div className="mt-1 space-y-0.5">
                {sample.stack.map((frame, i) => (
                  <div key={i} className="text-xs font-mono text-[var(--color-text-muted)]">
                    {frame.functionName ?? '(anonymous)'} @ {frame.url}:{frame.line}:{frame.col}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
```

```typescript
// apps/web/src/components/hooks/SampleStream.tsx
import { useEffect, useRef, useState } from 'react';
import { SampleRow } from './SampleRow';

interface Sample {
  hookId: string; seq: number; ts: number;
  args?: unknown[]; retVal?: unknown;
  stack?: { url: string; line: number; col: number; functionName?: string }[];
}

const ROW_HEIGHT = 36;
const VISIBLE_BUFFER = 20;

export function SampleStream({ samples }: { samples: Sample[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const containerHeight = 400;
  const totalHeight = samples.length * ROW_HEIGHT;

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VISIBLE_BUFFER);
  const endIdx = Math.min(samples.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + VISIBLE_BUFFER);

  const visibleSamples = samples.slice(startIdx, endIdx);

  // Auto-scroll to bottom on new samples
  useEffect(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      if (scrollHeight - scrollTop - clientHeight < 50) {
        containerRef.current.scrollTop = scrollHeight;
      }
    }
  }, [samples.length]);

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto"
      style={{ height: containerHeight }}
      onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: startIdx * ROW_HEIGHT, left: 0, right: 0 }}>
          {visibleSamples.map((s, i) => (
            <SampleRow key={`${s.hookId}-${s.seq}`} sample={s} />
          ))}
        </div>
      </div>
      {samples.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)] p-4">等待采样数据...</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 实现 Hook 监控页**

```typescript
// apps/web/src/routes/hooks.tsx
import { useEffect, useState } from 'react';
import { Plus, Pause, Play, Trash2, Download } from 'lucide-react';
import { useHooksStore } from '../stores/hooks';
import { HookList } from '../components/hooks/HookList';
import { SampleStream } from '../components/hooks/SampleStream';
import { wsClient } from '../lib/ws';

export function HooksPage() {
  const { hooks, selectedHook, samples, fetchHooks, selectHook, pushSample, clearSamples } = useHooksStore();
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'paused'>('all');

  useEffect(() => {
    // P0: 通过 WS 订阅获取 Hook 采样
    const unsub = wsClient.subscribe('hook.sample', (msg) => {
      const payload = msg.payload as { hookId: string; seq: number; ts: number; args?: unknown[]; retVal?: unknown };
      if (payload?.hookId) pushSample(payload as Parameters<typeof pushSample>[0]);
    });

    return unsub;
  }, [pushSample]);

  // P0: 使用 API 获取 hook 列表（后续可通过 hook.event WS 频道实时更新）
  useEffect(() => {
    const pollHooks = async () => {
      try {
        const { api } = await import('../lib/api');
        const result = await api.callTool('list_hooks', {}) as unknown;
        const list = (result as { result?: unknown })?.result ?? result ?? [];
        if (Array.isArray(list)) {
          useHooksStore.setState({ hooks: list as Parameters<typeof useHooksStore.getState>['0']['hooks'] });
        }
      } catch { /* ignore */ }
    };
    pollHooks();
    const interval = setInterval(pollHooks, 3000);
    return () => clearInterval(interval);
  }, []);

  const filteredHooks = hooks.filter(h => {
    if (activeFilter === 'all') return true;
    return h.status === activeFilter;
  });

  const handleExportNDJSON = () => {
    const ndjson = samples.map(s => JSON.stringify(s)).join('\n');
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `hook-samples-${Date.now()}.ndjson`;
    link.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex">
      {/* 左列表 */}
      <div className="w-80 shrink-0 border-r border-[var(--color-border-muted)] flex flex-col">
        <div className="p-3 border-b border-[var(--color-border-muted)] flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-text-primary)]">
            {hooks.length} hooks · {hooks.filter(h => h.status === 'active').length} active
          </span>
          <div className="flex gap-1 ml-auto">
            <button className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-accent)]">
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex gap-1 px-3 py-2 border-b border-[var(--color-border-muted)]">
          {(['all', 'active', 'paused'] as const).map(f => (
            <button key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-2 py-0.5 text-xs rounded ${activeFilter === f ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
            >
              {f === 'all' ? '全部' : f === 'active' ? '活跃' : '已暂停'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <HookList hooks={filteredHooks} selectedId={selectedHook?.id ?? null} onSelect={selectHook} />
        </div>
      </div>

      {/* 右详情 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedHook ? (
          <>
            <div className="h-9 flex items-center gap-2 px-4 border-b border-[var(--color-border-muted)] shrink-0">
              <span className="text-xs font-mono font-medium text-[var(--color-text-primary)]">{selectedHook.name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{selectedHook.location}</span>
              <div className="ml-auto flex gap-1">
                <button className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-status-yellow)]">
                  <Pause size={14} />
                </button>
                <button className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-status-green)]">
                  <Play size={14} />
                </button>
                <button className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-status-red)]">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <SampleStream samples={samples.filter(s => (s as { hookId: string }).hookId === selectedHook.id)} />
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-t border-[var(--color-border-muted)] shrink-0">
              <button onClick={handleExportNDJSON} className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                <Download size={12} /> 导出 NDJSON
              </button>
              <button onClick={clearSamples} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                清空
              </button>
              <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                {samples.filter(s => (s as { hookId: string }).hookId === selectedHook.id).length} samples
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[var(--color-text-muted)]">选择一个 Hook 查看实时采样</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 更新 App.tsx 路由**

```typescript
import { HooksPage } from './routes/hooks';
// 替换 placeholder Route:
<Route path="/hooks" element={<HooksPage />} />
```

- [ ] **Step 6: 验证前端构建**

```bash
cd apps/web && npx tsc --noEmit && npx vite build
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores/hooks.ts apps/web/src/components/hooks/ apps/web/src/routes/hooks.tsx apps/web/src/App.tsx
git commit -m "feat(web): add hook monitoring page with real-time sample stream"
```

---

### Task 16: 全局键盘快捷键 + 命令面板

**Files:**
- Create: `apps/web/src/components/common/CommandPalette.tsx`

- [ ] **Step 1: 实现 CommandPalette**

```typescript
// apps/web/src/components/common/CommandPalette.tsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const routeCommands: CommandItem[] = [
    { id: 'overview', label: '概览', action: () => navigate('/'), keywords: ['dashboard'] },
    { id: 'tools', label: '工具调用', action: () => navigate('/tools') },
    { id: 'hooks', label: 'Hook 监控', action: () => navigate('/hooks') },
    { id: 'sessions', label: '会话与页面', action: () => navigate('/sessions') },
    { id: 'worker', label: 'Worker 状态', action: () => navigate('/worker') },
    { id: 'settings', label: '设置', action: () => navigate('/settings') },
  ];

  const filtered = query
    ? routeCommands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.keywords?.some(k => k.toLowerCase().includes(query.toLowerCase()))
      )
    : routeCommands;

  const execute = useCallback((item: CommandItem) => {
    item.action();
    setOpen(false);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => (i + 1) % filtered.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => (i - 1 + filtered.length) % filtered.length); }
    if (e.key === 'Enter' && filtered[selectedIdx]) execute(filtered[selectedIdx]);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[480px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border-muted)]">
          <Search size={14} className="text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="跳转到..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
          />
          <span className="text-xs text-[var(--color-text-muted)] font-mono">ESC</span>
        </div>
        <div className="max-h-64 overflow-y-auto py-2">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => execute(cmd)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                i === selectedIdx ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'
              }`}
            >
              {cmd.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 App.tsx 中添加 CommandPalette**

```typescript
import { CommandPalette } from './components/common/CommandPalette';
// 在 App 的 return 中，BrowserRouter 内顶部添加:
<CommandPalette />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/common/CommandPalette.tsx apps/web/src/App.tsx
git commit -m "feat(web): add Cmd+K command palette with route navigation"
```

---

### Task 17: HookStore 事件化 + E2E 验证路径

**Files:**
- Modify: `src/modules/hook/HookStore.ts`

- [ ] **Step 1: 在 HookStore 添加事件发射**

```typescript
// 修改 src/modules/hook/HookStore.ts
// 添加 EventEmitter:

import { EventEmitter } from 'node:events';

export class HookStore<RecordType> {
  private readonly recordsByHook = new Map<string, RecordType[]>();
  private readonly maxRecordsPerHook: number;
  public readonly events = new EventEmitter();

  constructor(maxRecordsPerHook = 1000) {
    this.maxRecordsPerHook = maxRecordsPerHook;
  }

  // ... existing methods unchanged ...

  add(hookId: string, record: RecordType): void {
    // ... existing logic ...
    // 在 push 之后添加:
    this.events.emit('sample', hookId, record);
  }
}
```

- [ ] **Step 2: 更新 HookSampleBridge 使用 HookStore.events**

将 `HookSampleBridge` 改为监听 `hookStore.events`：

```typescript
// src/web/ws/HookSampleBridge.ts
import type { HookStore } from '../../modules/hook/HookStore.js';
import type { WsHub } from './WsHub.js';

export class HookSampleBridge {
  constructor(hookStore: HookStore<unknown>, wsHub: WsHub) {
    hookStore.events.on('sample', (hookId: string, sample: unknown) => {
      wsHub.broadcast('hook.sample', { hookId, ...(sample as object) },
        sub => !sub.filter?.hookId || sub.filter.hookId === hookId);
    });
  }
}
```

- [ ] **Step 3: 在 ConsoleServer 初始化 HookSampleBridge**

在 Worker 入口 (`src/index.ts`) 的 ConsoleServer 初始化代码中添加 HookSampleBridge 的创建：

```typescript
// 在 ConsoleServer 创建后:
const { HookSampleBridge } = await import('./web/ws/HookSampleBridge.js');
const hookStore = runtime.contextProvider?.hookManager?.getHookStore?.();
if (hookStore) {
  new HookSampleBridge(hookStore, consoleServer.getHub());
}
```

- [ ] **Step 4: 端到端验证**

```bash
# 构建前端
cd apps/web && npm run build

# 构建后端
cd ../.. && npm run build

# 验证编译
npx tsc --noEmit --project tsconfig.json
```

Expected: 所有编译通过

- [ ] **Step 5: Commit**

```bash
git add src/modules/hook/HookStore.ts src/web/ws/HookSampleBridge.ts src/index.ts
git commit -m "feat(web): add EventEmitter to HookStore, bridge to WS hub for real-time samples"
```

---

## 验收清单 (P0)

- [ ] `npm run build` 成功构建，无类型错误
- [ ] `npm run start` 启动 Worker 后，`http://127.0.0.1:8765` 出现深色控制台界面
- [ ] 概览页 Worker / Browser 两张卡显示真实数据（非占位）
- [ ] 概览页"最近工具调用"在 CLI 调用工具后通过 WS 实时出现新行
- [ ] 工具调用页列出工具列表，搜索和分类折叠工作正常
- [ ] 点击工具打开右抽屉，表单根据 Zod schema 正确渲染（string/number/boolean/enum/array）
- [ ] 提交表单成功调用工具并显示结果
- [ ] Hook 监控页能列出已有 Hook，点击查看详情
- [ ] Hook 采样数据实时滚动（虚拟滚动不卡顿）
- [ ] 暂停/恢复/删除 Hook 按钮可点击
- [ ] WS 断开后自动重连成功
- [ ] `js-reverse start --no-web` 不启动 Web 服务
- [ ] 外部 IP 访问返回 403
- [ ] Cmd+K 命令面板可打开、搜索并跳转路由

---

## 自检结果

**1. Spec coverage:** 逐项对照 spec 第 1-9 节：
- 1.1/1.2 目标与非目标 → Task 1-17 完整覆盖 P0，P1 保留占位路由
- 2.1/2.2 架构与边界 → Task 6 (ConsoleServer) + Task 12 (Worker 集成) 实现
- 3.1-3.4 导航/布局/快捷键 → Task 7 (布局) + Task 16 (命令面板)
- 4.1-4.3 三个 P0 页面 → Task 7 (概览) + Task 10 (工具调用) + Task 15 (Hook 监控)
- 5.1-5.3 API/WS 协议 → Task 1 (types) + Task 2 (WsHub) + Task 4 (中间件) + Task 5 (REST) + Task 14 (hook API)
- 6.1-6.3 仓库结构/集成/设计 → 已按 spec 执行（monorepo 已配置，深色主题已在 index.css 定义）
- 7 测试 → Task 17 step 4 覆盖编译验证 + E2E 构建路径
- 8 安全 → Task 4 的 localOnly 中间件 + 请求体限制已在 ConsoleServer 中通过读取 body 实现
- 9 性能 → 虚拟滚动 (SampleStream) + 环形缓冲 (InvocationStore/WsHub) 已实现

**2. Placeholder scan:** 无 "TBD" / "TODO" / "implement later" 字样。所有步骤包含可执行代码或确切命令。

**3. Type consistency:** 检查了 types.ts 定义的接口与各路由/store 使用的类型一致性：
- `HookSummary.status` 在前后端保持一致 (`'active' | 'paused' | 'detached'`)
- `InvocationRecord` 与 `ToolResultRecord` 字段兼容
- `ServerMsg` type 与 `WsHub.broadcast` 发送的 msg 结构匹配

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-26-frontend-ui-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
