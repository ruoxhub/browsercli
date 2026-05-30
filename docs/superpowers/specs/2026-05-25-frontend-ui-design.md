# JSReverser-CLI 前端工作台设计规格

> **创建日期**: 2026-05-25
> **作者**: 通过 brainstorming 流程协作产出
> **范围**: V1（P0 核心闭环 + P1 增强 + P2 展望）
> **目标读者**: 实现工程师、code reviewer

---

## 1. 目标与非目标

### 1.1 目标

为 JSReverser-CLI（`js-reverse-mcp` MCP 服务）提供一个**面向逆向工程师的本地 Web 工作台**，与现有 CLI 体验互补：

- 把"启动 Worker → 查看状态 → 浏览工具 → 调用工具 → 创建 Hook → 查看实时采样 → 查看错误"这条核心闭环搬到浏览器里
- **可视化对工具调用与 Hook 采样最有价值**：100+ 工具的 Zod schema 自动生成表单、Hook 采样实时滚动、调用历史可回溯
- **复用现有 Worker 后端**：不重写 Sekiro RPC、ToolAdapter、HookStore 等已有能力，只增加 Web 适配层
- **CLI 用户体验对齐**：保留键盘优先（命令面板、快捷键）、可复制 CLI 命令（UI 操作 ↔ CLI 调用等价）

### 1.2 非目标

- **不替代 CLI**：CLI 仍然是脚本化场景的一等公民
- **不做远程访问**：V1 只服务本机使用，不引入鉴权 / TLS / 远程网关
- **不做集成调试器**：CDP 直连、断点、源码同步不在 V1 范围（P2 展望）
- **不做 Pipeline 工作流编排**：放在 P2
- **不做 Electron/Tauri 桌面端**：保持轻量，与 npm CLI 用户预期一致

---

## 2. 架构与边界

### 2.1 整体架构

```
+----------------------------------------------------------------+
|  Browser (apps/web — React + Vite + Tailwind + shadcn/ui)      |
|  +----------------------------------------------------------+  |
|  | Layout: Sidebar | TopBar | Main | RightDrawer            |  |
|  | State : Zustand (Worker/Session/Tools/Hooks 4 store)     |  |
|  | Net   : fetch (REST 控制面)  +  ws (实时事件流)           |  |
|  +-----------+----------------------------+-----------------+  |
+--------------|----------------------------|--------------------+
        HTTP /api/*               WS /ws (multiplexed channels)
               |                            |
+--------------v----------------------------v--------------------+
|  Worker Process (src/index.ts)                                 |
|                                                                |
|  +-- src/web/ConsoleServer.ts ---------------------------+     |
|  |  http.createServer + WebSocketServer (复用 ws)        |     |
|  |  绑定 127.0.0.1:8765                                  |     |
|  |                                                       |     |
|  |  REST handlers           WS Channels                  |     |
|  |  /api/health             ch.worker  (status)          |     |
|  |  /api/tools              ch.hook    (samples)         |     |
|  |  /api/tools/:name/call   ch.invoke  (tool i/o)        |     |
|  |  /api/sessions           ch.log     (worker logs)     |     |
|  |  /api/hooks              ch.event   (lifecycle)       |     |
|  +------+------------------------------------------------+     |
|         |  call (in-process JS function)                       |
|         v                                                      |
|  Runtime singleton (runtime.ts)                                |
|  +- ToolRegistry / ToolAdapter (复用)                          |
|  +- SekiroInvoker            (走自身 RPC,与 CLI 同口径)        |
|  +- ToolContextProvider      (PageManager/HookStore/...)       |
|  +- HookStore.subscribe(samples → WS broadcast)                |
+----------------------------------------------------------------+
```

### 2.2 关键边界

- **ConsoleServer 是 Web/Worker 之间的唯一适配层**。Web 层只知道 REST + WS 协议，不直接 import Worker 内部模块。
- **Runtime 单例不受 Web 影响**。CLI 与 Web 共用同一个 `runtime.ts` 单例，互不感知。Web 层的所有调用最终落到 `SekiroInvoker.invoke(name, args)`，与 CLI `js-reverse call <tool>` 走同一管线。
- **ConsoleServer 嵌在 Worker 内部，不是独立子命令**。`js-reverse start` 启动 Worker 时附带拉起 Web 服务；进程同生同死，状态一致。
- **dev / prod 双模式**：
  - 开发：Vite 跑在 5173；ConsoleServer 把非 `/api`、非 `/ws` 的请求反代到 Vite
  - 生产：ConsoleServer 直出 `apps/web/dist` 静态资源
- **复用 debugger-lab 启动模式**：`scripts/debugger-lab/server.mjs` 已经是 http + ws 的样板，ConsoleServer 沿用同一风格。

---

## 3. 信息架构与导航

### 3.1 顶级路由（5 个）

| 路由 | 名称 | P 级 | 用途 |
|------|------|-----|------|
| `/` | 概览 | P0 | 仪表盘：Worker / Browser / 活跃 Hook / 最近调用 / 错误日志 |
| `/tools` | 工具调用 | P0 | 100+ 工具的探索 + Schema 表单 + 一键调用 + 历史 |
| `/hooks` | Hook 监控 | P0 | Hook 列表 + 实时采样流 + 采样统计 + 导出 |
| `/worker` | Worker 状态 | P0 | Worker 进程详情 + 完整日志（从概览的"查看日志"链入） |
| `/sessions` | 会话与页面 | P1 | Browser sessions / pages / frames / dialogs |
| `/settings` | 设置 | P1 | 解析后的 config 视图 + 可写项编辑（RPC host / Browser / AI key） |

> 不再嵌套二级 Tab。更深的层级走右抽屉。

### 3.2 全局布局

```
+------------------+--------------------------------------------------+
| JSReverser 控制台 | TopBar: Worker● daemon | RPC :5612 | Browser●… |
| v2.0.3            +--------------------------------------------------+
+------------------+                                                  |
| ■ 概览            |                                                  |
| --- 工作流        |               主内容区 (路由级页面)                |
| · 工具调用        |                                                  |
| · Hook 监控       |                                                  |
| --- 环境          |                                                  |
| · 会话与页面      |                                                  |
| · Worker 状态     |                                                  |
| · 设置            |                                                  |
|                   |                                                  |
| ● daemon 在线     |                                                  |
+------------------+                                                  |
                   |   RightDrawer (480-720px, 钉住可同屏对比)         |
                   +-------------------------------------------------+
```

- **左侧栏**：顶级路由 + 分组标签（工作流 / 环境）+ 底部 daemon 状态
- **顶部状态栏**：Worker / RPC / Browser / Sessions / Hooks 5 项常驻指示，颜色编码（绿=运行 / 黄=连接中 / 红=异常 / 灰=未启动）
- **主内容区**：每个顶级项一个独立页面
- **右抽屉**：承载工具详情、调用表单、Hook 详情、调用结果 JSON。可"钉住"，URL 可分享（`/tools?selected=create_hook`）

### 3.3 命令面板（`/` 或 `Cmd+K`）

- 工具搜索：输入工具名直接定位并打开右抽屉
- 路由跳转：`> 工具`、`> 设置`
- 最近调用历史：列出最近 10 次调用，回车重放

### 3.4 键盘快捷键

| 键位 | 行为 |
|------|------|
| `/` 或 `Cmd+K` | 打开命令面板 |
| `?` | 打开帮助 |
| `Esc` | 关闭右抽屉 / 命令面板 |
| `g d` | 跳转到概览 |
| `g t` | 跳转到工具调用 |
| `g h` | 跳转到 Hook 监控 |

---

## 4. P0 页面具体形态

### 4.1 概览（`/`）

**目的**：进来第一眼看到"系统在跑什么、刚才发生了什么、有没有问题"。

**布局：4 卡片网格**

1. **Worker 状态卡**：daemon 状态点 / pid / uptime / rpcHost。点击 [查看日志] 跳 `/worker`
2. **Browser 状态卡**：模式（CDP 连接 / Playwright 启动）/ wsEndpoint / 页面数 / Sessions 数。点击 [管理会话] 跳 `/sessions`
3. **活跃 Hook 卡**：列出 Hook 名 / 位置 / 采样数 / 末次采样时间。整行点击跳 `/hooks?selected=...`。底部 [查看全部 / 创建 Hook]
4. **最近工具调用 + 错误日志卡**（合并）：
   - 上半：最近 10 次调用，行级显示 时间 / 工具名 / 状态 / 耗时 / 摘要。点击展开右抽屉看 args/result/error 全文
   - 下半：近 24h 错误，按 level 分类（tool / hook / worker）

**实时性**：通过 WS 订阅 `worker.status`、`tool.invoke`、`hook.event` 三个频道增量更新。无 polling。

---

### 4.2 工具调用（`/tools`）

**目的**：100+ 工具的探索 + 调用入口，对标 MCP Inspector 但更贴合本项目。

**布局：左列表 + 右抽屉**

- **左列表**（占满主区）
  - 顶部：搜索框（同时匹配工具名、描述、参数名）
  - 下方：可折叠分类树（12 个分类，每个分类显示工具数和"hot"标记）
  - 工具行：工具名 / `★` 收藏 / 调用次数 / `●hot`（近 7 天调用过）
  - 工具行点击 → 右抽屉打开

- **右抽屉**（工具详情）
  - 头部：工具名 + 分类 + schemaVersion + 调用统计 + [钉住] [复制 cli]
  - 描述区：工具描述（取自 `defineTool` 的描述字段）
  - **参数表单**：服务端通过 `src/cli/zod-introspect.ts` 把 Zod schema 转成 JSON Schema 经 `/api/tools` 下发；前端按 JSON Schema 渲染
    - 标量（string/number/boolean）→ 对应输入控件
    - enum → radio / select
    - object → 嵌套字段组
    - array → 可增删的列表
    - 不支持的复杂结构（discriminated union 等）→ 退化为 JSON 文本框（约 80% 工具命中标量/对象/枚举/数组路径）
  - 操作区：[▶ 执行] [保存为模板] [复制 js-reverse call ... 命令]
  - 上次执行：折叠面板显示 input / output / log，可下载、可复制

**复用关键**：
- 工具元数据来自 `src/cli/tools-meta.ts`
- 参数表单生成基于 `src/cli/zod-introspect.ts`
- 调用执行通过 ConsoleServer → `runtime.invoker.invoke()`

---

### 4.3 Hook 监控（`/hooks`）

**目的**：Hook 是逆向场景里"高频持续观察"的核心，是 V1 里**高频实时数据流的主战场**（概览/工具页也吃 WS，但事件频率天然低）。

**布局：左列表 + 右详情（不是右抽屉，因为详情是这页主体）**

- **顶部条**：`8 hooks · 3 active · 5 paused` + [+ 新建 Hook] [全部暂停] [清空]

- **左列表**（约 320px 宽）
  - 每行：Hook 状态点 / Hook 名 / 位置 / capture 模式 / 采样数 / 末次采样时间
  - 点击行 → 右详情切换，列表保留滚动位置

- **右详情**
  - Hook 元信息：[暂停] [删除] 操作按钮
  - 采样进度条：N / 最大采样数
  - **实时采样区**（虚拟滚动，158 samples streaming 时不掉帧）
    - 每条采样一行：时间 / args 摘要 / retVal 摘要
    - 点击展开：调用栈 + 完整 JSON 树（react-json-tree 或 shadcn 自定义）
    - 调用栈每条可联动跳 `/tools` 的 `get_script_source` 查看脚本源码
  - **采样统计**：触发频率 / 平均执行时间 / 唯一 args 组合数
  - **导出**：[导出 NDJSON] [复制为 fixture]

**实时性**：WS 订阅 `hook.sample`，可按 `hookId` 过滤（订阅时附 filter，避免广播无关 Hook 的采样）。

---

## 5. API 与 WebSocket 协议契约

### 5.1 REST API（控制面）

**统一响应封装**：

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; details?: unknown }
  meta?: { traceId: string; ts: number }
}
```

**端点清单（V1）**：

| Method | 路径 | 用途 | P 级 |
|--------|------|------|-----|
| GET  | `/api/health`              | ping，返回 `{ ok, version, uptime }` | P0 |
| GET  | `/api/worker/status`       | Worker 完整状态（pid/rpcHost/browser/sessions） | P0 |
| GET  | `/api/worker/logs?tail=N`  | Worker 日志切片（默认 200 行） | P0 |
| GET  | `/api/tools`               | 工具元信息列表（含分类、Zod schema → JSON Schema） | P0 |
| GET  | `/api/tools/:name`         | 单个工具详情 + 调用历史摘要 | P0 |
| POST | `/api/tools/:name/call`    | 执行工具，body = `{ args, timeoutMs?, traceId? }` | P0 |
| GET  | `/api/invocations?limit=`  | 最近调用历史（含 args/result/duration/error） | P0 |
| GET  | `/api/invocations/:id`     | 单次调用详情（含完整输入输出） | P0 |
| GET  | `/api/hooks`               | 全部 Hook 列表 + 状态 + 采样数 | P0 |
| POST | `/api/hooks`               | 创建 Hook（封装 `create_hook` 工具，schema 更窄） | P0 |
| GET  | `/api/hooks/:id`           | Hook 详情 | P0 |
| GET  | `/api/hooks/:id/samples?cursor=` | Hook 历史采样（分页，游标） | P0 |
| POST | `/api/hooks/:id/pause`     | 暂停 Hook | P0 |
| POST | `/api/hooks/:id/resume`    | 恢复 Hook | P0 |
| DELETE | `/api/hooks/:id`         | 删除 Hook | P0 |
| GET  | `/api/sessions`            | Browser sessions / pages / frames | P1 |
| GET  | `/api/config`              | 当前 resolved config（脱敏 API key） | P1 |
| PATCH| `/api/config`              | 更新可写配置项（持久化到 user-level config.json） | P1 |

**关键决策**：
- `/api/tools/:name/call` 是唯一执行入口，内部调用 `runtime.invoker.invoke(name, args)`
- `/api/hooks` 是语义化封装，把"创建 Hook"从"调用 create_hook 工具"抽离成一等公民，schema 更窄、文档更聚焦
- 标准化错误码：`WORKER_OFFLINE` `BROWSER_UNAVAILABLE` `TOOL_NOT_FOUND` `INVALID_ARGS` `TOOL_TIMEOUT` `TOOL_ERROR` `INTERNAL_ERROR`

### 5.2 WebSocket（实时面）

单一连接 `ws://127.0.0.1:8765/ws`，多路复用 6 个频道。

**消息信封**：

```typescript
type ClientMsg =
  | { type: 'subscribe';   channel: Channel; filter?: Record<string, unknown> }
  | { type: 'unsubscribe'; channel: Channel }
  | { type: 'ping' }

type ServerMsg =
  | { type: 'event';    channel: Channel; ts: number; payload: unknown }
  | { type: 'snapshot'; channel: Channel; ts: number; payload: unknown }
  | { type: 'error';    channel?: Channel; code: string; message: string }
  | { type: 'pong';     ts: number }

type Channel =
  | 'worker.status'   // Worker 状态变化（连接/断开/重连/错误）
  | 'tool.invoke'     // 任意工具调用 (start / end / error)
  | 'hook.event'      // Hook 生命周期 (created / paused / resumed / deleted / detached)
  | 'hook.sample'     // Hook 采样数据流（高频，可被订阅 filter 限定 hookId）
  | 'browser.event'   // Page / Session / Dialog 变化
  | 'log'             // Worker 结构化日志（按 level filter）
```

**`hook.sample` payload**（高频，单条尽量小）：

```typescript
interface HookSampleEvent {
  hookId: string
  seq: number              // 该 Hook 内单调递增序号
  ts: number
  args?: unknown[]         // 截断后 (>32KB 一条记录截断为 reference)
  retVal?: unknown
  stack?: { url: string; line: number; col: number; functionName?: string }[]
  truncated?: boolean
  artifactRef?: string     // 截断时指向 artifact 文件
}
```

**关键决策**：
- 高频 (`hook.sample`) 与低频 (`tool.invoke`) 分通道
- `subscribe` 时附 filter（如 `{ hookId: 'h_x9k2' }`），服务端只发匹配的 Hook 采样
- `snapshot` 类型：订阅瞬间先发当前完整状态（如 worker.status 当前快照），随后才发增量 event。前端不需要"GET + WS 两步"。
- 背压：服务端按 `hookId` 维护环形缓冲（默认 1000 条），消费者落后时丢旧不丢新；前端虚拟滚动只渲染可见 30 条
- 断线重连：客户端记录最近 ts，重连后重新订阅；服务端不做事件回放（实时频道而非消息队列），历史样本走 REST `/api/hooks/:id/samples`
- `hook.sample` 服务端按 hookId 限速 ≤ 100/s，超出聚合为"丢弃 N 条"事件（`tool.invoke` 频率天然低，无需限速）

### 5.3 与现有 SekiroInvoker 的关系

```
Web Client
   |  POST /api/tools/create_hook/call  { args }
   v
ConsoleServer.routes.callTool()
   |  validate args (Zod)  → 生成 traceId  → 写 invocation 表
   |  emit ws 'tool.invoke' (start)
   v
runtime.invoker.invoke('create_hook', args, { timeoutMs })
   |  (复用 SekiroInvoker，与 CLI 走同一管线)
   v
ToolAdapter → ToolRegistry → tool handler (e.g. create_hook)
   v
返回结果
   |  写 invocation.result
   |  emit ws 'tool.invoke' (end)
   v
HTTP 200 响应
```

Hook 采样流额外接一根线：

```
HookStore.onSample(hookId, sample)
   |  (Worker 内置发布订阅，已有 HookStore，加一个 listener)
   v
ConsoleServer.broadcast({ channel: 'hook.sample', payload })
   |  (只发给订阅了该 hookId 或全部 hook.sample 的客户端)
   v
Web Client (虚拟滚动渲染)
```

---

## 6. 实现方案与仓库结构

### 6.1 仓库结构（monorepo 增量改造）

仓库由单包 npm 改造为 npm workspaces。Worker 仍为根包，新增 `apps/web` 子包。

```
JSReverser-CLI/
├── package.json                  ← 根：加 workspaces 字段
├── package-lock.json             ← 单一锁文件
├── tsconfig.json                 ← 不变
├── src/                          ← Worker 现有源码
│   ├── index.ts                  ← Worker 入口（修改：启动 ConsoleServer）
│   ├── runtime.ts                ← 不动
│   ├── web/                      ← 新增：ConsoleServer 模块
│   │   ├── ConsoleServer.ts
│   │   ├── routes/
│   │   │   ├── tools.ts
│   │   │   ├── hooks.ts
│   │   │   ├── worker.ts
│   │   │   ├── invocations.ts
│   │   │   ├── sessions.ts
│   │   │   └── config.ts
│   │   ├── ws/
│   │   │   ├── WsHub.ts          ← 频道+订阅+广播
│   │   │   ├── HookSampleBridge.ts  ← 接 HookStore.onSample
│   │   │   └── ToolInvokeBridge.ts  ← 接 ToolAdapter 的 start/end 钩子
│   │   ├── adapters/
│   │   │   ├── ZodToJsonSchema.ts ← 复用 zod-introspect.ts 输出
│   │   │   └── InvocationStore.ts ← 内存环形缓冲，1000 条
│   │   ├── middleware/
│   │   │   ├── error.ts
│   │   │   ├── trace.ts
│   │   │   └── localOnly.ts
│   │   ├── proxy.ts              ← dev 模式反代 Vite
│   │   └── types.ts              ← 协议类型（与 apps/web 共享）
│   ├── cli/commands/start.ts     ← 修改：附加 --no-web / --web-port
│   └── ...
├── apps/
│   └── web/                      ← 新增：前端
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── routes/
│       │   │   ├── overview.tsx
│       │   │   ├── tools.tsx
│       │   │   ├── hooks.tsx
│       │   │   ├── sessions.tsx
│       │   │   └── settings.tsx
│       │   ├── components/
│       │   │   ├── layout/{Sidebar,TopBar,RightDrawer}.tsx
│       │   │   ├── tools/{CategoryTree,ToolForm,InvocationLog}.tsx
│       │   │   ├── hooks/{HookList,SampleStream,SampleRow}.tsx
│       │   │   ├── overview/{WorkerCard,BrowserCard,RecentInvocations,ErrorLog}.tsx
│       │   │   ├── common/{StatusDot,JsonTree,VirtualList,CommandPalette}.tsx
│       │   │   └── ui/...        ← shadcn/ui 生成的组件
│       │   ├── stores/
│       │   │   ├── worker.ts     ← Zustand store
│       │   │   ├── tools.ts
│       │   │   ├── hooks.ts
│       │   │   └── invocations.ts
│       │   ├── lib/
│       │   │   ├── api.ts        ← REST 客户端，类型从 src/web/types.ts 复用
│       │   │   ├── ws.ts         ← WS 客户端，订阅/重连
│       │   │   ├── schema.ts     ← JSON Schema → 表单字段
│       │   │   └── theme.ts      ← Tailwind 深色主题 token
│       │   └── styles/index.css
│       └── public/
├── scripts/
│   └── debugger-lab/             ← 保留，仅作为 Hook 测试 fixture
├── tests/
│   └── unit/web/                 ← ConsoleServer 单测
└── tests/integration/web/        ← E2E（Playwright，复用 patchright）
```

**类型共享**：`src/web/types.ts` 是协议契约的真理源；`apps/web` 通过 tsconfig 的 `paths` 映射读取（同 monorepo path alias），不发布、不复制。

### 6.2 关键集成点

**Worker 启动序列**（修改 `src/cli/commands/start.ts`）：

```
1. resolveConfig()
2. RpcClient.connect()           ← 连 Sekiro
3. runtime.init()                ← 现有
4. ToolAdapter.registerAll()     ← 现有
5. (新) if (!flags.noWeb) {
     consoleServer = new ConsoleServer({
       port: cfg.webPort ?? 8765,
       runtime,
       invoker,
     })
     await consoleServer.listen()
     log(`控制台 http://127.0.0.1:${port}`)
   }
6. process.on('SIGTERM', async () => {
     await consoleServer?.close()  ← 优先关 web，再关 worker
     await workerLifecycle.shutdown()
   })
```

**HookStore 事件桥**（`src/web/ws/HookSampleBridge.ts`）：

```typescript
hookStore.on('sample', (hookId, sample) => {
  wsHub.broadcast(
    'hook.sample',
    { hookId, ...sample },
    /* filter */ subscriber =>
      subscriber.filter?.hookId == null || subscriber.filter.hookId === hookId
  )
})
```

**ToolAdapter 事件桥**（最小侵入）：在 `ToolAdapter.invoke()` 包一层 hook，invoke 前后发 `tool.invoke` 事件。优先利用现有 `ToolResponseAccumulator` 的回调点接入，避免直接改 ToolAdapter 公共 API。

### 6.3 设计语言（深色技术控制台）

- **配色**：深色背景（`#0b0e14` / `#11151c`）+ 冷调主色（`#7aa2f7` 蓝紫 / `#9ece6a` 绿）+ 状态色（绿成功 / 黄连接中 / 红错误 / 灰未启动）
- **字体**：UI 用 Inter / 系统字体；代码、JSON、stack trace 用 JetBrains Mono / Fira Code 等宽字体
- **组件库**：shadcn/ui（Radix-based），Tailwind 深色主题 token 自定义
- **信息密度**：偏高，每行一条信息说完，避免大字号和过多图标
- **参考**：VSCode / Chrome DevTools / Linear

---

## 7. 测试与验收

### 7.1 测试矩阵

| 层级 | 工具 | 覆盖目标 |
|------|------|---------|
| Worker 端单测 | node:test + sinon | ConsoleServer 路由、WsHub 订阅过滤、错误码映射、Zod→JSONSchema 转换 |
| Worker 端集成 | node:test | 端到端：启动 ConsoleServer → REST 调用 → WS 订阅 → 断开重连 |
| 前端单测 | vitest（项目已配置） | 表单生成（schema.ts）、Zustand store reducer、WsClient 重连状态机 |
| 前端组件 | vitest + @testing-library/react | ToolForm、SampleStream、CommandPalette |
| E2E | Playwright（patchright 同源） | 启动 → 概览 → 工具调用 → Hook 创建 → 采样流出现 |

**覆盖目标 80%**：
- Worker 端 `src/web/` 模块严格 80%
- 前端组件优先级：概览 > 工具调用 > Hook（采样虚拟滚动有可视化测试难度，允许略低）

### 7.2 验收标准（P0）

- [ ] `npm run start` 启动 Worker 后，浏览器访问 `http://127.0.0.1:8765` 出现概览页
- [ ] 概览页 Worker / Browser 两张卡显示真实数据，不是占位
- [ ] 概览页"最近工具调用"在 CLI 调用工具后 1 秒内出现新行
- [ ] 工具调用页能列出至少 80% 的工具
- [ ] 工具调用页对至少 5 个常用工具（list_tools、navigate_page、create_hook、get_script_source、list_network_requests）能完整生成表单并成功调用
- [ ] Hook 监控页能创建 Hook、采样数据实时滚动、暂停 / 恢复 / 删除工作正常
- [ ] WS 断开后自动重连成功
- [ ] `js-reverse start --no-web` 不启动 Web 服务，CLI 路径不回归
- [ ] 任一非 127.0.0.1 / ::1 客户端访问均 403

---

## 8. 安全与边界

- **localOnly 中间件**：HTTP / WS 都校验 `req.socket.remoteAddress ∈ {127.0.0.1, ::1}`，外部 IP 直接 403。即使 host 配置改了也不破防。
- **CORS**：默认不开 CORS。前端与服务端同源（ConsoleServer 既出 API 也出静态资源）。
- **API key 脱敏**：`/api/config` 返回 `apiKey: "sk-***xxx"`，PATCH 才允许改写，且不把明文写日志。
- **请求体上限**：默认 1 MB；POST `/api/tools/:name/call` 上限 4 MB（够覆盖大部分参数场景，超出走 artifact 引用）。
- **WS 帧上限**：默认 256KB，超出截断并写 artifact 文件、payload 改为 `artifactRef`。
- **超时**：工具调用默认 30s，可被 args 覆盖。ConsoleServer 启动超时 5s，失败不阻塞 Worker（仅记 warn）。

---

## 9. 性能预算

| 指标 | 预算 |
|------|------|
| ConsoleServer 启动开销（叠加在 Worker 启动） | ≤ 200ms |
| `/api/tools` 响应（100 工具元信息） | ≤ 80ms |
| WS `hook.sample` 端到端延迟（采样产生 → 浏览器收到） | ≤ 100ms (本机) |
| 前端首屏 LCP（vite 构建产物，本地加载） | ≤ 800ms |
| 前端 bundle gzip 大小 | ≤ 280KB（P0 不引入 monaco；P1+ 若引入则 dynamic import 仅按需加载） |
| Hook 采样以 50/s 速率持续 5min，浏览器内存增量 | ≤ 50MB |

---

## 10. 里程碑

### P0：核心闭环（约 5 个工作日）

| Day | 交付物 |
|-----|-------|
| D1  | monorepo 改造 + apps/web 脚手架 + 深色主题 + 路由 + 布局骨架 |
| D2  | ConsoleServer + REST `/api/health` `/api/worker/status` `/api/tools` + 概览页接通 |
| D3  | `/api/tools/:name/call` + 工具调用页 + 表单生成（zod-introspect → schema） |
| D4  | WS Hub + `worker.status` `tool.invoke` 通道 + 概览实时刷新 |
| D5  | `/api/hooks` + `hook.sample` WS 通道 + Hook 监控页 + E2E 关键路径测试 |

### P1：增强（约 4-5 个工作日）

- Artifact 浏览（`/api/artifacts/*` + 前端文件树 / 预览）
- 网络 / Console / Script 实时观测（接现有 PageManager + DataCollectorManager）
- Sessions 页（多页面 / Frame / Dialog 管理）
- 命令面板（Cmd+K 全局工具搜索）
- 配置页（`/api/config` PATCH）

### P2：高级（暂不展开）

- Pipeline 工作流可视化（DAG 绘制 + 进度回写）
- 集成调试器（CDP 直连、源码、断点）

---

## 11. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Zod schema 复杂度高（嵌套 / discriminated union），表单生成不可读 | 中 | 中 | P0 仅支持 80% 工具：标量 / 对象 / 枚举 / 数组；剩余 20% 退化为"原始 JSON 文本框"，不阻塞发布 |
| Hook 采样高频导致 WS 阻塞 | 中 | 高 | 服务端按 hookId 限速 ≤ 100/s，超出聚合为"丢弃 N 条"事件 |
| ConsoleServer 启动失败影响 Worker | 低 | 中 | 启动失败仅 warn，不抛；提供 `--no-web` 兜底 |
| 现有 ToolAdapter 没有 invoke hook 钩子 | 中 | 中 | 增量加 EventEmitter；不改 ToolAdapter 公共 API；测试覆盖现有 CLI 路径不回归 |
| 前端 bundle 超预算（Tailwind + shadcn + monaco） | 低 | 低 | monaco 仅 tools 页 dynamic import；P0 不引入 monaco，先用 textarea + react-json-tree |
| npm workspaces 改造与 swc 构建链冲突 | 中 | 中 | 改造前先在 spike 分支验证 `npm run build` 全套脚本不破，特别是 build:index / build:compile / build:post |

---

## 12. 决策记录

通过 brainstorming 流程逐项确认：

1. **目标用户**：逆向工程师工作台
2. **部署关系**：Worker 内置 Web 服务（非独立子命令、非桌面 App）
3. **V1 范围分阶段**：P0 概览 + 工具调用 + Hook；P1 加 Artifact / 网络 / Sessions；P2 加 Pipeline / 调试器
4. **前端技术栈**：React + Vite + Tailwind + shadcn/ui
5. **设计语言**：深色技术控制台
6. **实时通信**：WebSocket 全件
7. **鉴权**：全本机不鉴权（localOnly 中间件）
8. **仓库结构**：Monorepo 子包 `apps/web`
9. **工具调用路径**：Web → Worker 内部 → SekiroInvoker（与 CLI 同管线）
10. **布局骨架**：左侧栏 + 顶部状态 + 主内容 + 右抽屉
11. **Web 服务实现**：复用 debugger-lab 的 `http + ws` 模式（方案 A），不引入 express
