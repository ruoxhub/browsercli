# 设计文档：HTTP 解耦的 CLI 客户端 + 独立 Worker 服务

- **日期**：2026-07-13
- **状态**：已与用户确认（含会话模型与 Sekiro 去留两项决策）
- **范围**：把现有 `browsercli`（CLI）与 `js-reverse-worker`（Worker）之间的 Sekiro(rpc-go) broker 解耦，改为 Worker 直接暴露原生 HTTP API，CLI 作为纯 HTTP 客户端调用。Worker 成为可跨网络部署的独立服务。

---

## 1. 背景与目标

### 1.1 现状
仓库当前已把 CLI 与 Worker 解耦，但传输层依赖外部 broker **Sekiro (rpc-go)**：

- CLI 端 `browsercli` 通过 `SekiroInvoker` 向 `POST /business/invoke` 发 HTTP 请求。
- Worker 端 `js-reverse-worker`（`src/index.ts` 的 `main()`）启动 `RpcClient` 经 WebSocket 注册到 Sekiro，由 Sekiro 转发请求给 `ToolAdapter` 包装的 Action。
- Worker 内的 `ConsoleServer`（`src/web/ConsoleServer.ts`）已自带一套 HTTP REST + WebSocket 服务（默认 `127.0.0.1:8765`，路由在 `src/web/routes/*`，事件经 `WsHub` 广播），但其 `tools` 路由当前仍通过 `SekiroInvoker` 代理转发。

### 1.2 目标
1. **原生 HTTP 传输**：CLI 直接对 Worker 的 HTTP 接口发请求，去掉 Sekiro 这一外部依赖。
2. **可跨网络部署**：Worker 监听可配置 host/port，支持非 loopback 绑定，并带 Bearer Token 认证。
3. **通用 HTTP API**：设计稳定、通用的 REST 接口（工具发现 / 会话 / 异步任务），CLI 只是其中一个客户端，其他脚本/服务也能直接调用。
4. **会话化状态**：支持跨调用的逻辑会话，用于隔离 hook 配置、逆向任务态等。
5. **异步任务语义**：工具调用以异步 Job 提交，客户端轮询或通过 WebSocket 订阅结果/流，适配长耗时任务（去混淆、长分析、hook 持续采样）。

### 1.3 非目标（本设计不做）
- 实现原生 TLS（建议生产环境用反向代理，如 nginx，做 HTTPS）。
- 每会话独立浏览器隔离（v1 共享单例浏览器，见 §5.3）。
- Job 结果持久化到数据库（v1 仅内存，见 §5.2）。
- 替换 web 控制台现有路由（仅新增 `/api/v1` 分层，原控制台保持不变）。

---

## 2. 总体架构

```
┌──────────────┐            HTTP /api/v1              ┌──────────────────────────────┐
│  browsercli  │  POST /sessions/:id/invoke          │  js-reverse-worker           │
│ (HTTP 客户端) │ ──────────────────────────────────▶ │  (独立服务, 可跨网络)         │
│              │ ◀── GET /jobs/:id (轮询) ────────── │  ConsoleServer (扩展)         │
│ + WS 流式     │ ◀── WS /sessions/:id/stream ────── │   ├─ /api/v1  对外稳定 API    │
└──────────────┘                                      │   ├─ /         web 控制台(原)  │
                                                      │   └─ ToolExecutionPipeline    │
                                                      │      (经 ToolAdapter 直连)     │
                                                      └──────────────────────────────┘
```

- **Worker 端**：扩展现有 `ConsoleServer`，新增 `/api/v1` 分层路由 + Bearer Token 中间件 + 异步 Job 层。工具执行复用现有 `ToolAdapter` 内的 `ToolExecutionPipeline`，不再经 Sekiro broker。
- **CLI 端**：`browsercli` 瘦身为纯 HTTP 客户端，移除 `SekiroInvoker` / `WorkerManager` 主路径（保留代码用于可选回退，见 §7）。
- **复用基础**：`RestRouter`、`WsHub`、`ToolAdapter`、`ToolExecutionPipeline`、`tools-meta` 的 `getToolMeta()` 全部直接复用，不重写。

---

## 3. Worker 服务（服务端）设计

### 3.1 配置（env 或 `js-reverse-worker` 启动参数，优先级 CLI > env > 默认）
| 配置项 | 默认 | 说明 |
|---|---|---|
| `WORKER_HOST` | `127.0.0.1` | 监听地址；跨网络设为 `0.0.0.0` |
| `WORKER_PORT` | `8765` | 监听端口 |
| `WORKER_API_TOKEN` | 未设置 | 设置后且绑定非 loopback → 强制 `Authorization: Bearer <token>` |
| `JS_REVERSE_TOOL_PROFILE` | `full` | 工具发现时按 profile 过滤（`workflow` / `full`） |

### 3.2 `ConsoleServer` 改造
当前 `ConsoleServer.start()` 对所有请求先调用 `rejectIfNotLocal(req, res)`（强制 loopback），且硬编码 `listen(port, '127.0.0.1')`。改造点：

1. **监听 host 可配置**：新增 `ConsoleServerOptions.host`，`start()` 改为 `this.httpServer!.listen(this.options.port, this.options.host, ...)`。
2. **本地校验仅作用于控制台/静态资源**：`/api/v1/*` 请求豁免 `rejectIfNotLocal`，改走 Bearer Token 中间件（见 §4）。其余路径（web 控制台、静态资源）保持 `rejectIfNotLocal` 不变。
3. **新增依赖注入**：`ConsoleServerOptions` 增加 `toolAdapter: ToolAdapter`（已有）、`apiToken?: string`、`bindHost: string`，供 `/api/v1` 路由使用。移除对 `invoker: SekiroInvoker` 在 `/api/v1` 路径上的依赖（`tools` 控制台路由可继续用 invoker 或后续迁移）。
4. **启动期预热**：`ConsoleServer` 启动时调用 `ensureToolsMeta()`，保证 `getToolMeta()` 缓存可用。

### 3.3 新增 `/api/v1` 路由（`src/web/routes/apiV1.ts`）

通过 `RestRouter.mount(createApiV1Routes(deps))` 挂载，路径前缀 `/api/v1`。

| 方法 | 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| GET | `/health` | — | `{status:'ok', version, uptimeMs, browserMode}` | 存活探针 |
| GET | `/tools` | `?profile=`(可选) | `{tools: ToolMeta[]}` | 按 `JS_REVERSE_TOOL_PROFILE` 或 query 过滤 |
| GET | `/tools/:name` | — | `ToolMeta` | 单工具 schema/元数据；404 若不存在 |
| POST | `/sessions` | body 可选 `{name?}` | `{sessionId, createdAt}` | 创建会话 |
| GET | `/sessions` | — | `{sessions: SessionSummary[]}` | 列举活跃会话 |
| DELETE | `/sessions/:id` | — | `{deleted:true}` | 销毁会话（清理其 hook/任务态） |
| POST | `/sessions/:id/invoke` | body `{tool:string, params?:object}` | `202` + `{jobId, sessionId, status:'pending'}` | 提交异步 Job（立即返回，结果轮询 `/jobs/:id`） |
| GET | `/jobs/:id` | — | `JobStatus`（见 §5.2） | 轮询任务状态/结果 |
| WS | `/sessions/:id/stream` | — | 事件流 | 订阅该会话的 `hook.sample` / `log` / `job` 事件（按 sessionId 过滤） |

- 路由实现从 `getToolMeta(name)` 同步取得 `ToolMeta`，调用 `toolAdapter.executeTool(meta, params, sessionId)` 执行（见 §5.1）。
- 所有 `/api/v1` 接口返回 `application/json`；错误统一 JSON 结构 `{error:{code,message,details?}}`（见 §6）。

---

## 4. 认证模型（Bearer Token）

- **中间件**：新增 `src/web/middleware/bearerAuth.ts`，仅作用于 `/api/v1/*`。
- **规则**：
  - 若 `WORKER_API_TOKEN` 未设置 **且** 绑定为 loopback（`127.0.0.1`/`::1`）→ 不强制认证（开发便利）。
  - 若绑定非 loopback **或** 显式设置 `WORKER_API_TOKEN` → 要求请求头 `Authorization: Bearer <token>`，缺失/错误返回 `401`。
- **Token 来源**：Worker 端从 `WORKER_API_TOKEN` 读取（建议通过 MCP client `env` 或 `.env` 注入，不进仓库）。CLI 端从 `WORKER_API_TOKEN` 读取并附带到请求头。
- **传输安全**：本设计不实现原生 TLS；跨网络安全依赖反向代理（HTTPS 终止）。文档中将给出 nginx 示例。

---

## 5. 会话与任务模型

### 5.1 工具执行入口
在 `ToolAdapter` 新增公共方法，复用其已有的 `pipeline` 实例：

```ts
async executeTool(
  meta: ToolMeta,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<unknown> {
  if (sessionId) this.contextProvider.setActiveSession(sessionId);
  try {
    return await this.pipeline.execute(meta, params);
  } finally {
    if (sessionId) this.contextProvider.clearActiveSession();
  }
}
```

- `pipeline.execute(meta, rawParams)` 已封装：参数校验（zod）→ handler 加载 → `ToolExecutionRouter` 分发（`defineTool`/`frame`/`context`）→ 响应归一化。
- `getToolMeta(name)` 同步返回含 `modulePath`/`handlerName` 的 `ToolMeta`，正是 `pipeline` 所需。

### 5.2 异步 Job 模型（内存）
新增 `src/worker/JobStore.ts`：

```ts
interface Job {
  jobId: string;
  sessionId: string;
  tool: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: { code: string; message: string };
  logs: string[];        // 执行期可选日志（来自 eventBus / console）
  createdAt: string;
  finishedAt?: string;
}
```

- `POST /sessions/:id/invoke`：校验工具存在 → 创建 `Job`（状态 `pending`）→ 交由后台 runner `toolAdapter.executeTool(...)` → 完成后写入 `result`/`error` 并置 `done`/`failed`。
- 后台 runner 与事件桥接：复用 `ToolAdapter.onInvoke` 与 `WsHub` 广播机制（`tool.invoke` / `hook.sample`），使 `GET /jobs/:id` 能返回进度、`WS /stream` 能推送事件。
- **内存语义**：Job 存于 `Map<jobId, Job>`，Worker 重启即丢失（v1 可接受）。`logs` 为尽力收集的轻量日志，非全量 stdout。
- 游标：`jobId` 用 `job_<base36时间戳>_<random>` 生成。

### 5.3 会话与状态隔离（已确认决策）
- **v1：共享单例浏览器**，`sessionId` 作为**逻辑命名空间**，用于隔离 hook 配置与逆向任务态。
- 实现：`contextProvider.setActiveSession(id)` 在执行前后设置/清除；`HookManager` / `ReverseTaskStore` 读取当前 active session 作为 key 前缀。
- **已知限制**：若这些存储当前尚未 session-aware，v1 会话仍提供 Job 隔离与流订阅作用域，完整 hook/任务态隔离列为后续扩展（不阻塞本设计落地）。
- **每会话独立浏览器**：明确列为后续扩展，不在本设计实现。

---

## 6. 错误处理

| 场景 | HTTP 状态 | 结构 |
|---|---|---|
| 工具不存在 | `404` | `{error:{code:'TOOL_NOT_FOUND',message}}` |
| 参数校验失败（zod） | `400` | `{error:{code:'VALIDATION',message,details: <zod 错误>}}` |
| 会话不存在 | `404` | `{error:{code:'SESSION_NOT_FOUND'}}` |
| Job 不存在 | `404` | `{error:{code:'JOB_NOT_FOUND'}}` |
| 缺少/错误 Token（受保护路由） | `401` | `{error:{code:'UNAUTHORIZED'}}` |
| 执行期异常 | 提交时 `202`；结果经 `GET /jobs/:id` 返回 `status:'failed'` + `error` | `JobStatus` |
| 服务器未启动 | CLI 侧捕获 ECONNREFUSED → 提示 “worker 是否运行？请先启动 js-reverse-worker” | — |

- Worker 内部异常统一经 `ToolError` 包装（已有 `createToolError` / `ErrorCodes`），写入 `job.error` 后由轮询接口返回，避免长连接中断导致结果丢失。
- CLI 连接拒绝时给出可操作的提示，而非裸堆栈。

---

## 7. Sekiro 去留（已确认决策）

- **默认路径移除 Sekiro**：`js-reverse-worker` 默认不再创建 `RpcClient` / 连接 Sekiro；`browsercli` 默认不再使用 `SekiroInvoker`。
- **代码保留 + 可选回退**：`src/modules/protocol/Client.ts`（RpcClient）、`src/cli/sekiro-invoker.ts`、`ToolAdapter.wrapTool` 等 Sekiro 相关代码**保留不删除**，通过环境变量 `WORKER_TRANSPORT=sekiro` 可选回退到旧传输，保证可回滚。默认 `WORKER_TRANSPORT=http`。
- **`index.ts` 改造**：`main()` 仅在 `WORKER_TRANSPORT !== 'http'`（即显式 `sekiro`）时创建并连接 `RpcClient`、走 `toolAdapter.registerAll(...)` 旧路径；默认 `http` 时跳过，仅启动 `ConsoleServer` 的 `/api/v1`。
- **CLI `app.ts` 改造**：`resolveContext` 不再构造 `SekiroInvoker` + `WorkerManager`，改为构造 `WorkerHttpClient`（见 §8）。Sekiro 路径在 `WORKER_TRANSPORT=sekiro` 时仍可经旧的 `SekiroInvoker` 分支启用。

---

## 8. CLI（客户端）设计

### 8.1 新增 `src/cli/WorkerHttpClient.ts`
- 配置：`WORKER_URL`（默认 `http://127.0.0.1:8765`）、`WORKER_API_TOKEN`。
- **两套接口并存**（request-response 对 CLI 透明）：
  - **底层原语**（供其他客户端/测试直接使用）：`submitInvoke(sessionId, tool, params)` → 返回 `jobId`；`getJob(id)` → 轮询 `JobStatus`；`openStream(sessionId, onEvent)`（WebSocket）。
  - **request-response 封装**：`invoke(sessionId, tool, params, opts?)` 内部 `submitInvoke` → 循环 `getJob` 直到 `done`/`failed`（带超时与轮询间隔，默认超时 `WORKER_TIMEOUT_MS` 或 300s）→ **返回最终 `result` 或抛出 `job.error`**。CLI 命令代码只需 `const result = await httpClient.invoke(...)`，表现为单请求-单响应。
- 自动附带 `Authorization: Bearer` 头（若 token 已配置）。

### 8.2 命令改造（复用现有 `src/cli/args-parser.ts`、`tool-args.ts` 的参数解析与类型强制）
| 命令 | 行为 |
|---|---|
| `call <tool> [args...]` | 解析参数（flags > `--data` > `--file` > `--stdin`，含 zod 类型强制）→ 取/建 session（`--session <id>` 或自动建）→ **`await httpClient.invoke(sessionId, tool, params)`**（内部封装提交+轮询，对命令代码即 request-response）→ 打印结果；`--watch` 额外开 `openStream` 订阅该会话事件 |
| `list-tools` | `GET /tools` |
| `sessions` | `POST`（新建）/ `GET`（列举）/ `DELETE <id>`（销毁） |
| `status` | `GET /health` |
| `start` / `stop` | **不再 spawn 远程 worker**。改为本地便捷启动 `js-reverse-worker` 进程（不带 Sekiro）供开发用；生产文档明确 worker 作为独立服务运行（systemd / docker / 反向代理） |

- 移除 `src/cli/sekiro-invoker.ts` 在 CLI 主路径的引用（保留文件，见 §7）。

---

## 9. 测试策略

- **unit**（`tests/unit/web/`）：
  - `WorkerHttpClient` 请求构造、Bearer 头注入逻辑、`/jobs/:id` 轮询终止条件。
  - `JobStore` 生命周期（`pending→running→done/failed`）、`sessionId` 隔离。
  - `bearerAuth` 中间件在 loopback/非 loopback、有/无 token 下的放行/拒绝矩阵。
  - 复用现有 `tool-args.ts` 参数强制测试。
- **integration**（`tests/integration/`）：
  - 起 loopback Worker → `browsercli call <简单工具>` 经 HTTP 拿到 Job 结果。
  - 非 loopback 绑定 + 无 token → `401`；带 token → 正常。
  - `WS /sessions/:id/stream` 能收到 `tool.invoke` 事件。
- **回归**：原 Sekiro 传输测试在 `WORKER_TRANSPORT=sekiro` 下仍可通过；默认 `http` 下的旧 Sekiro 调用测试更新为走 HTTP 路径。

---

## 10. 迁移与落地

1. 新增 `/api/v1` 路由与 `JobStore`、`bearerAuth`、`WorkerHttpClient`（不影响现有 Sekiro 路径）。
2. `index.ts` / `app.ts` 增加 `WORKER_TRANSPORT` 分支，默认 `http`；Sekiro 路径保留可回退。
3. 文档：在 `docs/` 补充「以独立服务部署 worker」指南（含跨网络 bind、nginx HTTPS、Token 配置示例）。
4. 提交遵循 Conventional Commits；不提交任何真实 Cookie / Storage / 生产参数。

---

## 11. 已知限制（v1 边界，不阻塞）

- Job 仅内存存储，重启丢失。
- v1 共享浏览器，会话仅作状态命名空间，非浏览器隔离。
- 不实现原生 TLS，跨网络依赖反向代理。
- `tools` web 控制台路由仍可能引用 `SekiroInvoker`（§3.2.3），后续可统一迁移到 `/api/v1` 执行路径。
