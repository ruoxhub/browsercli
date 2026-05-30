# Spike B+D: 状态事件原生能力清点 & 表单源选型

> **日期**: 2026-05-26
> **结论摘要**: 5 个 P0 数据流里有 **3 个完全免费**（EventBus 已 emit、ContextProvider 已暴露 collectors、ToolAdapter 已挂在 runtime 上），1 个**几乎免费**（Worker 状态聚合属于纯组装），1 个**需要小改**（HookStore 上加一条事件桥）。表单源选型推荐**直接吃 ToolArgSpecMap**，无需扩展 JSON Schema。规格 §6.2 的"加 EventEmitter 到 ToolAdapter"前提**不成立**。

---

## 1. 数据流可复用度概览

| # | 数据流 | 现状 | P0 增量工作 |
|---|--------|------|------------|
| 1 | Hook 采样（hook.sample 频道）| `HookStore.add` 是纯写入，无事件；`HookManager.addRecord` 是入口 | **HookManager 加 EventEmitter 风格订阅**（约 15 行）|
| 2 | 工具调用 start/end（tool.invoke 频道）| `runtime.eventBus` 已 emit `tool:called` / `tool:error`，由 ToolTelemetry 在 success/failure 中触发 | **零代码改动**，订阅 eventBus |
| 3 | Worker 状态（worker.status 频道）| `RpcClient.getStatus()` 已聚合所有连接信息；BrowserManager / ContextProvider 暴露快照 | 写一个聚合函数（约 30 行），无新事件 |
| 4 | Web 工具调用入口 | runtime + ToolAdapter 都是 Worker 进程内的活实例，可直接拿 | **直连 ToolAdapter**，不走 SekiroInvoker 回路（推荐）|
| 5 | 表单源 | ToolArgSpecMap 覆盖 89/135 工具完整字段（66%），22/135 部分字段，24/135 无参数 | 直接吃 ToolArgSpecMap，剩余字段降级为 JSON 文本框 |

---

## 2. 数据流 1：Hook 采样实时流（hook.sample）

### 2.1 现状
- **HookStore（src/modules/hook/HookStore.ts）**：
  - 是 `class HookStore<RecordType>`，内部一个 `Map<string, RecordType[]>`
  - 提供 `ensure / add / get / remove / clear / snapshot / getHookIds`，**无 EventEmitter**
  - L29-39 `add(hookId, record)`：环形缓冲 1000 条，**纯静默写入**

- **HookManager（src/modules/hook/HookManager.ts）**：
  - 持有 `private hookStore: HookStore<HookDataRecord>`
  - L329-334 `addRecord(hookId, record)` 是浏览器端回传 → Worker 端写入的**唯一入口**
  - 这是规格里 `hookStore.on('sample', ...)` 真正应该挂的地方（HookManager 而非 HookStore）

- **采样写入触发点**：浏览器端注入的 hook 脚本在执行后通过 `window.__hookStore[hookId].push(...)`，Worker 端通过工具（如 `get_hook_data`）读回。**当前无主动推送**：Worker 不会主动得知"浏览器又有新采样了"，必须通过 tool 调用拉取。

### 2.2 缺口
- 无事件订阅 → 实时 WS 流没有数据源
- 浏览器端 → Worker 端是**拉模式**（poll），Web 控制台想要**推模式**就要在拉的时机 emit

### 2.3 补法（最小侵入）

**A. HookManager 上挂 EventEmitter**（首选）：

```typescript
// src/modules/hook/HookManager.ts
import {EventEmitter} from 'node:events';

export interface HookManagerEvents {
  'sample': [hookId: string, record: HookDataRecord];
  'created': [meta: HookMeta];
  'removed': [hookId: string];
}

export class HookManager extends EventEmitter {
  // ... 现有字段不动 ...

  addRecord(hookId: string, record: HookDataRecord): void {
    const meta = this.hooks.get(hookId);
    if (meta) meta.callCount++;
    this.hookStore.add(hookId, record);
    this.emit('sample', hookId, record);    // ← 新增 1 行
  }

  create(options): {hookId; script} {
    // ... 现有逻辑 ...
    this.emit('created', meta);              // ← 新增 1 行
    return {hookId, script};
  }

  remove(hookId: string): boolean {
    this.hookStore.remove(hookId);
    const ok = this.hooks.delete(hookId);
    if (ok) this.emit('removed', hookId);    // ← 新增 1 行
    return ok;
  }
}
```

**B. 让浏览器端在 push 时主动调用 Worker**：超出 P0 范围，需改 hook 脚本生成器，留给 P2。

### 2.4 风险与现有调用方影响

| 风险点 | 评估 |
|--------|------|
| EventEmitter 引入 backpressure | 同步 emit，所有监听器同步执行，单 listener（ConsoleServer 桥）不会阻塞 |
| 现有 `addRecord` 调用方 | 仅 1 处（src/modules/hook/HookManager.ts:333），无 break |
| 性能 | 每条采样多 1 次 emit + 0~1 个 listener 回调；规格 §11 要求服务端限速 ≤ 100/s/hook，节流逻辑放 ConsoleServer 桥层即可 |
| 测试 | tests/unit/modules/HookStore.test.ts 测的是 HookStore 不动；HookManager 现有测试如有，需验证 EventEmitter 不破坏 enable/disable/remove |

> **注意**：本仓库 HookStore 是**复制泛型类**，src/modules/hook/HookStore.ts:11 注明"Google LLC"版权 —— 与上游 Chrome DevTools MCP 共用同一份，**不要在 HookStore 里加事件**（会污染 upstream 同步）。事件挂在 HookManager 这层，HookStore 保持纯容器语义。

---

## 3. 数据流 2：工具调用 start/end（tool.invoke）

### 3.1 现状（**最大惊喜**）

`runtime.eventBus` 是 `EventBus<AppEventMap>`（src/runtime.ts:76），AppEventMap 定义在 src/types/events.ts:9-19：

```typescript
export interface AppEventMap {
  // ... 其他事件 ...
  'tool:called': {name: string; durationMs: number; success: boolean};
  'tool:error': {name: string; code: string; message: string};
}
```

ToolTelemetry（src/worker/ToolTelemetry.ts:13-47）在 ToolExecutionPipeline 调用 success/failure 时已经 emit：
- L27 `this.contextProvider.eventBus.emit('tool:called', {name, durationMs, success: true})`
- L36 `this.contextProvider.eventBus.emit('tool:error', {name, code, message})`

`ToolContextProvider.eventBus` 与 `runtime.eventBus` 是**同一个实例**（src/worker/ToolContextProvider.ts:71 `runtime?.eventBus ?? new EventBus(...)`，main 进程里 contextProvider 用 runtime 构造，所以共享）。

### 3.2 缺口
**没有缺口**。规格 §11 风险表说"现有 ToolAdapter 没有 invoke hook 钩子，需加 EventEmitter"——这个前提**不成立**。

唯一不完美之处：`tool:called` 不带 args/result（只带 name/durationMs/success）。这正合 ConsoleServer 用意——前端看 `recent invocations` 行级摘要够用了；要看完整 args/result，调 REST `/api/invocations/:id`。

### 3.3 补法
ConsoleServer 启动后，立刻订阅：

```typescript
// src/web/ws/ToolInvokeBridge.ts (草图)
runtime.eventBus.on('tool:called', payload => {
  wsHub.broadcast('tool.invoke', { kind: 'end', success: true, ...payload });
});
runtime.eventBus.on('tool:error', payload => {
  wsHub.broadcast('tool.invoke', { kind: 'end', success: false, ...payload });
});
```

**没有 start 事件**。如果前端要 start 事件（"工具开始执行了"），有 3 个选项：
1. 由 ConsoleServer 自身在 `/api/tools/:name/call` 受理时立刻 broadcast `start`，直连 ToolAdapter 之前发（推荐——ConsoleServer 已经是入口，最自然）
2. 在 ToolExecutionPipeline.execute 第一行 emit `tool:start`（需扩展 AppEventMap）
3. 不做 start，前端只在调用前自己渲染"calling..."直到 `tool:called` 到达（最简）

P0 选 1 或 3。

### 3.4 风险
EventBus.emit 是同步且 catch 失败的（src/utils/EventBus.ts:44-49 `forEach + void`），单 listener 不会污染原 emit 路径。

---

## 4. 数据流 3：Worker 状态（worker.status）

### 4.1 现状

| 字段 | 来源 | 引用 |
|------|------|------|
| `pid` | `process.pid` | Node global |
| `uptime` | `process.uptime() * 1000` | Node global |
| `rpcHost` | `client.getStatus().rpcHost` | src/protocol/Client.ts:172-182 |
| `connectionState` | `client.getStatus().connectionState` | 同上，值 `'disconnected' / 'connecting' / 'connected' / 'reconnecting'` |
| `actionCount` | `client.getStatus().actionCount` | 同上（已注册的 action 数）|
| `group / clientId` | `client.getStatus()` | 同上 |
| `browser.connected` | `contextProvider.isBrowserConnected()` | src/worker/ToolContextProvider.ts:135-137 |
| `browser.url` | `runtime.browserManager.config.browserUrl`（间接）| BrowserManager 内部 |
| `pages.count` | `contextProvider.getPages().length` | src/worker/ToolContextProvider.ts:192-194 |
| `selectedPageUrl` | `contextProvider.getSelectedPage()?.url()` | src/worker/ToolContextProvider.ts:159-161 |
| `hooks.totalEnabled` | `runtime.hookManager.getStats().enabledHooks` | src/modules/hook/HookManager.ts:376 |

### 4.2 缺口
- **无统一聚合函数**。需要写一个 `getWorkerStatusSnapshot(): WorkerStatus` 在 ConsoleServer 中。
- **状态变化无事件**：`RpcClient` 内部有 `setConnectionState`（L234），但**未 emit 任何事件**。Web 想要 `worker.status` WS 推送 connect/disconnect 变化，必须做下列之一：

  **A. 给 RpcClient 加事件**（小改）：在 `setConnectionState` 内部 emit `runtime.eventBus.emit('worker:connectionChanged', ...)`——需扩展 AppEventMap。

  **B. 在 ConsoleServer 内部 1Hz 轮询并 diff**（无侵入）：每秒读 `client.getStatus()`，与上次比较，差异时广播。简单粗暴但增加 1 个 setInterval。

  **C. WS 客户端首次连接发 snapshot，之后只在 tool:called 等其他事件到达时刷新**（最简）：用其他高频事件触发状态拉取。

P0 推荐 **B**（轮询 + diff）：
- 1Hz 间隔，CPU 可忽略
- 无需改 RpcClient（避免修改协议层）
- 真断线/重连本来也是秒级体感，1s 颗粒度合理
- 实现复杂度最低

### 4.3 补法（草图）
```typescript
// src/web/ws/WorkerStatusBridge.ts (草图)
let lastSnapshot: string = '';
setInterval(() => {
  const snap = JSON.stringify(getWorkerStatusSnapshot(client, runtime, contextProvider));
  if (snap !== lastSnapshot) {
    lastSnapshot = snap;
    wsHub.broadcast('worker.status', JSON.parse(snap));
  }
}, 1000);

// 订阅时立即推一次 snapshot（不等下一次 diff）
wsHub.onSubscribe('worker.status', subscriber => {
  subscriber.send({ type: 'snapshot', channel: 'worker.status', payload: getWorkerStatusSnapshot(...) });
});
```

### 4.4 风险
- **轮询 vs 事件**：未来如果想做"连接抖动可视化"（毫秒级），轮询 1Hz 不够。届时再加 RpcClient 事件。P0 不需要。

---

## 5. 数据流 4：Web 工具调用入口选型（关键决策）

规格 §5.3 那张图的拓扑（Web → ConsoleServer → `runtime.invoker.invoke()` → SekiroInvoker → HTTP → Sekiro Server → WS → 回到 Worker 自己 → ToolAdapter handler）有问题：**Worker 进程通过 RPC 回环调用自己**，多 1 跳网络 + 1 跳 HTTP + Sekiro Server 路由。

### 5.1 直连 ToolAdapter 路径

ToolAdapter 实例已经在 main() 里创建（src/index.ts:76），把它作为构造参数传给 ConsoleServer：

```typescript
// ConsoleServer 构造时收到 toolAdapter 引用
class ConsoleServer {
  constructor(opts: { toolAdapter: ToolAdapter; /* ... */ }) {}
}

// ConsoleServer 处理 POST /api/tools/:name/call 时：
async function callTool(name: string, args: Record<string, unknown>) {
  const meta = getToolMeta(name);
  if (!meta) throw new ToolError('TOOL_NOT_FOUND');
  return await this.toolAdapter['pipeline'].execute(meta, args);
  // 或暴露公开方法：toolAdapter.execute(meta, args)
}
```

**优势**：
- 0 网络跳数 — 纯进程内函数调用
- 不依赖 Sekiro Server 在线（Sekiro 在 §10 风险表里也是依赖项之一）
- 错误对象保真 — ToolError 直接抛回 ConsoleServer，不需序列化反序列化

**代价**：
- ToolAdapter 当前没有 `execute(meta, args)` 公开方法，只有 `wrapTool(meta)` 返回 ActionHandler（src/worker/ToolAdapter.ts:62-70）
- 需要小改：暴露 `pipeline.execute(meta, params)` 或加一个 `invoke(name, params)` 包装

### 5.2 SekiroInvoker 回路路径

Web Client → ConsoleServer → SekiroInvoker.invoke('group', 'tool', params) → HTTP POST 到 Sekiro Server → Sekiro 通过 WS 路由回**当前 Worker** → RpcClient.handleRpcRequest → handler

**优势**：
- "与 CLI 严格同管线" — 规格的初衷
- 如果未来想做"多 Worker 模式"（一个 group 多个客户端），Sekiro 的负载均衡天然就有了

**代价**：
- 多 1 跳 HTTP + 1 跳 WS（虽然都是 localhost）
- 多了 JSON 序列化往返
- Sekiro Server 不可用时 Web 控制台直接死（违背规格 §11 "失败仅 warn"原则——Sekiro 挂掉本来不该让 Worker 也挂掉，但 SekiroInvoker.invoke 会抛错）
- 错误对象失真（ToolError → JSON → reconstructed Error，code 丢失）

### 5.3 推荐：**直连 ToolAdapter**

理由：
1. **拓扑诚实**：Web → Worker 内部，本来就是同进程，应该用同进程方式
2. **韧性更好**：Sekiro 故障时 Web 仍可用（只是不能看到"是不是已注册到 Sekiro"，但工具本身可调）
3. **故障域隔离**：Web 调用故障不会经 Sekiro 二次包装，错误信息更清晰
4. **性能**：0 跳 vs 2 跳，端到端延迟差 5-30ms，对工具调用频次无所谓但对开发体验有差
5. **真要"严格同管线"**：CLI 走 SekiroInvoker 是因为 CLI 本来就在另一个进程；Web 在 Worker 内，强行走外部回路不是"对齐"，是"绕远"

**取舍交代清楚**：用户在 Web 看到调用结果与用户从 CLI `js-reverse call <tool>` 看到的，**不是字节级一致**——CLI 多走了一遍 Sekiro 回路。但是结果的语义、错误码、Tool handler 执行路径都是一致的（共享 ToolAdapter / ToolExecutionPipeline / ToolRegistry / handler）。这层差异规格里应明确写出来。

**未来扩展**：plan 阶段可在 ConsoleServer 里加一个 `?via=sekiro` 旗标（dev-only），让"我想验证 Sekiro 链路是否健康"的用户能切换。P0 不做。

---

## 6. 数据流 5：表单源选型（ToolArgSpecMap vs JSON Schema）

### 6.1 实测覆盖度（基于 build/ 产物，2026-05-26）

```
total: 135
fullyCovered: 89 (66%)
partial: 22 (16%)
empty (无参数): 24 (18%)
```

**全部覆盖（89 个）**：标量参数（string / number / boolean / enum / string[]）+ 默认值 + 描述。这是 ToolArgSpecMap 完整能力的体现。

**部分覆盖（22 个）的失败原因**：
- `anti_anti_debug` (spec 0/1)：参数是 `zod.array(zod.enum(...))`。zod-introspect.ts:78-83 的 ZodArray 分支只接受 `element instanceof ZodString`，对枚举数组直接 `return null`。
- `summarize_code` (spec 3/4)：`files` 字段是 `zod.array(zod.object({...}))`，同样被跳过。
- `bypass_debugger` (spec 0/1)：根据手测，参数是 `zod.array(zod.enum(...))` 或 zod.object 嵌套。
- `search_in_sources` (spec 2/8)：含 `zod.boolean().optional().default(false)` × 4（这本来该被覆盖），spec 只有 2 表明还有别的不识别字段（推测有 `zod.union` 或复杂 `zod.string().refine(...)` 规格在 P0 落地前需现场再 grep 一次）。

**关键观察**：失败模式都是"复合数组 / 嵌套 object" —— 这正是规格 §11 风险表预期的"20% 退化为原始 JSON 文本框"。

### 6.2 扩展 zod-introspect 输出 JSON Schema 的工作量评估

需要做的：
1. 引入 `zod-to-json-schema`（npm 包，~30KB） 或手写转换器
2. 替换 `extractArgSpecsFromSchema` 调用方（src/cli/tools-meta.ts:128-129）
3. 前端用一个 JSON Schema → React 表单的库（如 `@rjsf/core` ~200KB gzip）

**潜在问题**：
- bundle 增加 ≥ 200KB，超出规格 §9 的 280KB 预算
- `@rjsf/core` 默认样式与 shadcn/ui 不一致，需写 ThemeAdapter
- ZodEffects（refine / transform）在 zod-to-json-schema 下输出限制——本仓库已经在很多 schema 里用了 transform（要现场扫一遍）

### 6.3 推荐：**直接吃 ToolArgSpecMap**

理由：
1. **0 后端改动** —— 规格 §4.2 写"服务端通过 zod-introspect.ts 把 Zod schema 转成 JSON Schema 经 /api/tools 下发"是**无效需求**（zod-introspect 不输出 JSON Schema），实际产出的是 ToolArgSpecMap，前端直接吃即可
2. **66%/16%/18% 的分布刚好是规格 §11 自陈的"P0 仅支持 80% 工具"** —— 完全覆盖 + 无参数 = 84%，超过 80% 目标
3. **partial 工具在前端也可以正常用**：能识别的字段渲染表单，不能识别的字段降级为"原始 JSON 字符串"输入框（前端拼到 args 里）
4. **bundle 体积**：自定义渲染器约 5KB（Zustand-driven 表单组件），远低于 @rjsf 200KB
5. **未来想要更强**：plan 阶段后期或 P1 再扩 zod-introspect，**不阻塞 P0**

### 6.4 落地建议

前端 `apps/web/src/lib/schema.ts`：

```typescript
import type { ToolArgSpec, ToolArgSpecMap } from '@js-reverse/types';

// 后端 /api/tools 直接下发 ToolArgSpecMap，前端按 type + enum + required 渲染：
//   string + enum  → <Select>
//   string         → <Input>
//   number         → <Input type="number">
//   boolean        → <Switch>
//   string[]       → <ChipInput>
//   object         → <Textarea>（JSON 字符串）
//
// 表单提交时按 spec.type 反向解析（textarea 走 JSON.parse）。
// 字段缺失（partial 工具）：界面顶部显示"此工具的部分参数无法可视化，需手填 JSON"，
// 提供一个 <Textarea name="__rawArgs">，与解析的标量字段合并提交。
```

---

## 7. 总结：P0 范围内需要新增/扩展的最小 API surface

| 模块 | 改动类型 | 行数估算 | 风险 |
|------|----------|----------|------|
| `src/modules/hook/HookManager.ts` | 加 EventEmitter，emit `sample`/`created`/`removed` | +15 | 低（同步 emit，原 Map 行为不变）|
| `src/worker/ToolAdapter.ts` | 暴露 `execute(meta, params)` 公开方法 | +5 | 低（只是把 `private pipeline` 露出受控接口）|
| `src/web/ws/WorkerStatusBridge.ts` | 新文件，1Hz 轮询 + diff 广播 | ~50 | 低（无侵入）|
| `src/web/ws/ToolInvokeBridge.ts` | 新文件，订阅 eventBus | ~25 | 零（只读消费）|
| `src/web/ws/HookSampleBridge.ts` | 新文件，监听 hookManager 事件 | ~30 | 零（只读消费）|
| `src/cli/zod-introspect.ts` | **不改** | 0 | — |

**重大修正（与规格分歧）**：

| 规格说法 | 实际情况 | 修正 |
|---------|---------|------|
| §4.2 "服务端把 Zod schema 转成 JSON Schema" | zod-introspect 输出 ToolArgSpecMap，不输出 JSON Schema | 直接下发 ToolArgSpecMap，前端按字段类型渲染 |
| §6.2 `hookStore.on('sample', ...)` | HookStore 是纯 Map 容器，无事件 | 把订阅口放在 `HookManager`，挂 EventEmitter |
| §11 "ToolAdapter 没有 invoke hook 钩子，需加 EventEmitter" | runtime.eventBus 已 emit `tool:called`/`tool:error`（ToolTelemetry 已经在 emit）| 直接订阅 eventBus，**不动 ToolAdapter** |
| §5.3 "Web → SekiroInvoker → 回 Worker 自己" 拓扑图 | Worker 内调 RPC 回路是绕远 | **直连 ToolAdapter.execute**，注明与 CLI 路径的语义等价但字节不同 |

详见 [[spike-a-lifecycle]] §10。

---

## 8. 给后续 plan 的具体建议

1. **HookManager EventEmitter 改造单独拎一个 commit**：风险低、收益清晰、可独立测试
2. **ToolAdapter.execute(...) 暴露做最小化**：只 expose 一个 `async execute(name: string, args: Record<string, unknown>): Promise<unknown>`，内部 `getToolMeta(name)` + `this.pipeline.execute(meta, args)`。不要暴露 pipeline 本身
3. **/api/tools 响应 schema 加固**：返回 `{ name, description, category, argSpecs, hasUnsupportedFields: boolean }`，让前端能预先告诉用户"此工具部分参数将以 JSON 输入"
4. **WS Bridge 文件单独建模块**：每个 channel 一个 bridge 文件，便于 plan 时按 task 拆分
5. **partial 工具具体清单**：plan 第一天先用 build 后的产物跑一遍 §6.1 的脚本，把 22 个 partial 工具的具体字段缺失原因列出来。如果其中包含高频工具（如 `search_in_sources`），值得单独把 zod-introspect 扩成认识 `zod.array(zod.enum(...))`（约 5 行改动），把覆盖度推到 90%+。
