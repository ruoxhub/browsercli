# 独立部署 Worker 服务

本指南说明如何把 `js-reverse-worker`（`src/index.ts` 进程）作为**可独立部署的 HTTP 服务**运行，
并让 CLI `browsercli` 作为纯 HTTP 客户端通过 Worker 原生的 `/api/v1` 接口调用它。

这是任务计划中将 `browsercli`（CLI）与 `js-reverse-worker`（Worker）解耦的产物：
旧版的 Sekiro broker 已被 Worker 原生 HTTP API 取代。Sekiro 现在仅作为显式 opt-in 的回退路径保留。

> 文档中的所有行为描述均对应**已落地的代码**。未实现的能力统一在「已知限制」一节标注，
> 不会伪装成可用功能。

## 1. 概述

- **Worker**（`node build/src/index.js`）默认以 HTTP 传输模式启动：仅拉起 `ConsoleServer`
  并挂载 `/api/v1`，**不连接 Sekiro**。
- **CLI**（`browsercli call <tool>`）通过 `WorkerHttpClient`（`src/cli/WorkerHttpClient.ts`）
  以 request-response 方式调用 Worker：内部懒建并缓存会话，提交 Job 后再轮询至终态。
- 跨网络调用时，应配合 **Bearer Token**（`WORKER_API_TOKEN`）+ **反向代理 HTTPS**，不要明文暴露公网。

## 2. 启动 Worker 服务

Worker 端实际读取的环境变量与 CLI 参数如下（见 `src/index.ts`）：

| 变量 / 参数             | 默认值      | 说明                                                                |
| ----------------------- | ----------- | ------------------------------------------------------------------- |
| `WORKER_TRANSPORT`      | `http`      | 传输方式。`http` = 启动 `/api/v1`；`sekiro` = 回退旧 RpcClient 路径 |
| `WORKER_HOST`           | `127.0.0.1` | 绑定地址。跨网络绑 `0.0.0.0` 时必须配 Token + HTTPS 反代            |
| `WORKER_API_TOKEN`      | 未设置      | 设置后所有 `/api/v1/*` 需 `Authorization: Bearer <token>`           |
| `--console-port <port>` | `8765`      | **HTTP 服务端口（CLI 参数，不是环境变量）**                         |

> ⚠️ **端口不是环境变量 `WORKER_PORT`**。Worker 监听端口由 CLI 参数 `--console-port` 控制，
> 默认 `8765`。

启动示例（本机开发，loopback + 无 Token）：

```bash
node build/src/index.js --console-port 8765
```

跨网络启动（绑定 `0.0.0.0`，必须配 Token）：

```bash
WORKER_HOST=0.0.0.0 \
WORKER_API_TOKEN=<your-token> \
node build/src/index.js --console-port 8765
```

- 默认 `WORKER_TRANSPORT=http`，**不连 Sekiro**。
- `WORKER_HOST` 默认 `127.0.0.1`；跨网络绑 `0.0.0.0` 时必须配 Token + HTTPS 反代。
- `WORKER_API_TOKEN`：设置后所有 `/api/v1/*` 需要 `Authorization: Bearer <token>`；
  loopback 且无 Token 仍放行（见 `src/web/middleware/bearerAuth.ts`）。

## 3. 客户端配置

CLI 端实际读取的环境变量（见 `src/cli/app.ts`）：

| 变量               | 默认值                  | 说明                          |
| ------------------ | ----------------------- | ----------------------------- |
| `WORKER_URL`       | `http://127.0.0.1:8765` | Worker 的 HTTP 基址（含端口） |
| `WORKER_API_TOKEN` | 未设置                  | 需与 Worker 端一致            |
| `WORKER_TRANSPORT` | `http`                  | 与 Worker 端协商一致即可      |

调用示例：

```bash
WORKER_URL=http://<worker-host>:8765 \
WORKER_API_TOKEN=<your-token> \
browsercli call <tool-name> --url <url> [--data '<json>']
```

- `WORKER_URL` 默认 `http://127.0.0.1:8765`；`WORKER_API_TOKEN` 必须与 Worker 端一致。
- `WORKER_TRANSPORT=http` 为默认（与 Worker 端协商一致即可）。

> ⚠️ **`--session` 显式会话 ID 暂不可用**：当前 `call` 命令的 `--session` 标志会被参数校验拦截
> （`session` 不在任何工具的 schema 中，会在 `validateToolArgs` 阶段被拒），所以会话实际由
> `WorkerHttpClient.ensureSession` 内部懒建并缓存（sessionId 实际为 `undefined` 时自动建）。
> 显式 `--session` 支持为后续任务。详见「已知限制」。

## 4. nginx HTTPS 反向代理示例

跨网络务必走 HTTPS，并透传 `Authorization` 头：

```nginx
server {
  listen 443 ssl;
  # ssl_certificate /etc/nginx/ssl/worker.crt;
  # ssl_certificate_key /etc/nginx/ssl/worker.key;

  location /api/v1/ {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
    proxy_read_timeout 300s;   # 长耗时逆向任务
  }
}
```

CLI 端对应改为指向 HTTPS 地址即可：

```bash
WORKER_URL=https://<worker-host>/ \
WORKER_API_TOKEN=<your-token> \
browsercli call <tool-name> --url <url>
```

## 5. 回退 Sekiro

若需回到旧的 Sekiro broker 路径，两端都设 `WORKER_TRANSPORT=sekiro`：

```bash
# Worker 端：走旧 RpcClient -> Sekiro Server 路径
WORKER_TRANSPORT=sekiro node build/src/index.js
```

```bash
# CLI 端：call 命令回到 SekiroInvoker.invoke
WORKER_TRANSPORT=sekiro browsercli call <tool-name> --url <url>
```

> Sekiro 路径下不挂载 `/api/v1`，也不使用 `WORKER_URL` / `WORKER_API_TOKEN` 的 HTTP 语义。

## 6. API 速查表

下表与 `src/web/routes/apiV1.ts` 实际路由一致（注意 `invoke` 返回 `202`、`jobs` 返回 Job 对象）：

| 方法   | 路径                          | 说明                                                                                  |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/v1/health`              | 健康检查（`{status:'ok', uptimeMs, version}`）                                        |
| GET    | `/api/v1/tools`               | 工具列表（`{tools:[...]}`）                                                           |
| GET    | `/api/v1/tools/:name`         | 单工具元信息（404 `TOOL_NOT_FOUND`）                                                  |
| POST   | `/api/v1/sessions`            | 创建会话 → **201** `{sessionId, createdAt}`                                           |
| GET    | `/api/v1/sessions`            | 会话列表（`{sessions:[...]}`）                                                        |
| DELETE | `/api/v1/sessions/:id`        | 删除会话（404 `SESSION_NOT_FOUND`）                                                   |
| POST   | `/api/v1/sessions/:id/invoke` | 提交 Job → **202** `{jobId, sessionId, status:'pending'}`（body 需 `{tool, params}`） |
| GET    | `/api/v1/jobs/:id`            | 查询 Job 状态/结果/错误（Job 对象）                                                   |
| WS     | `/api/v1/sessions/:id/stream` | 会话事件流（**服务端端点尚未挂载，规划中**；客户端 `--watch` 已 try/catch 不崩）      |

**Job 对象形状**（`GET /api/v1/jobs/:id` 返回）：

```ts
{
  jobId: string;
  sessionId: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: { code: string; message: string };
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}
```

失败时 CLI 以 `[code] message` 形式抛出（对应 `error.code` / `error.message`）。

## 7. 延迟说明

`WorkerHttpClient.invoke` 的实现是「提交 + 轮询」：

- **会话缓存**：`ensureSession` 仅在进程内首次调用时建会话（付 1 RTT）；
  之后同一进程复用缓存 sessionId，不再付建会话开销。
- **首轮立即查询**：`invoke` 提交后第 0ms 立即 `getJob`（不会空等一个轮询间隔）。
- **额外轮询延迟**：仅当 Job 仍未到终态时，才会按 `pollIntervalMs` 间隔轮询；
  单次额外等待 ≤ `pollIntervalMs`（默认 **300ms**，可调小到约 100ms）。
- **超时**：`timeoutMs` 默认 **300000ms**（5 分钟），超时抛 `invoke timeout after ...` 错误。

> `timeoutMs` / `pollIntervalMs` 当前是 `WorkerHttpClientOptions` 的构造项
> （`src/cli/WorkerHttpClient.ts`），**尚未**暴露为 `WORKER_TIMEOUT_MS` / `WORKER_POLL_MS`
> 环境变量。如需在 CLI 侧调参，要在 `src/cli/app.ts` 接入这两个变量并传给构造器。

## 8. 安全提示

- 跨网络**必须**设置 `WORKER_API_TOKEN` + 反向代理 HTTPS（不要用明文 http 暴露公网）。
- `bearerAuth` 中间件规则（`src/web/middleware/bearerAuth.ts`）：未设 Token 且绑定 loopback
  → 放行；绑定非 loopback **或**显式设了 Token → 要求 `Authorization: Bearer <token>`，否则返回 401。
- loopback 无 Token 放行仅用于本机开发，不要在生产环境绑 `0.0.0.0` 时依赖它。
- 不要提交真实 Cookie / Storage / 生产参数；仓库只跟踪模板目录（`scripts/cases/`）。
- 不要把 `WORKER_API_TOKEN` 硬编码进脚本或提交到仓库；优先通过 MCP client 的 `env` 注入或本地 `.env`。

## 9. 已知限制 / 后续任务

以下为当前代码**尚未实现**的能力，文档如实标注，避免误导：

1. **`--session` 显式会话 ID 暂不支持**：`call` 命令的 `--session` 标志会被参数校验拦截
   （`session` 不在工具 schema 中）。会话一律由 `WorkerHttpClient.ensureSession` 懒建并缓存。
   显式 `--session` 支持为后续任务。
2. **服务端 WS `/stream` 端点尚未挂载**：`src/web/routes/apiV1.ts` 未注册
   `/api/v1/sessions/:id/stream` 路由，因此 `--watch` 流式输出端到端尚不可用。
   CLI 侧 `openStream` 调用已包在 try/catch 中，仅是告警而不中断主结果返回。
3. **`timeoutMs` / `pollIntervalMs` 未暴露为环境变量**：二者是 `WorkerHttpClientOptions`
   构造项，当前无 `WORKER_TIMEOUT_MS` / `WORKER_POLL_MS`。如需可调，是后续增强项。
