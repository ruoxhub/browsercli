# proxycli 浏览器连接控制设计

- 日期：2026-08-14
- 状态：已确认，待实现
- 范围：为纯远程 `proxycli` 增加 `browser connect|disconnect|status` 命令，并通过稳定的 `/api/v1` 契约控制 Worker 的全局浏览器连接。

## 1. 背景

`proxycli` 只通过 Worker 的 `/api/v1` HTTP 契约通信，不管理本地 Worker 进程。Worker 已有供本地 Web 控制台使用的 `/api/browser/connect` 与 `/api/browser/disconnect`，但这些路由受 loopback 边界保护，不属于可跨网络使用的稳定 API。

本设计新增受 Bearer Token 保护的 `/api/v1/browser/*` 路由。新路由复用现有 `RuntimeConfigStore`、`BrowserConfigSchema` 和 `BrowserConnectionManager`，不复制浏览器生命周期逻辑，也不改变 Web 控制台现有接口。

## 2. 目标与非目标

### 目标

1. 提供 `proxycli browser connect|disconnect|status` 命令组。
2. `connect` 可使用 Worker 当前配置，也可用常用 CLI 参数增量更新 Worker 的内存配置后连接。
3. 连接目标切换时清除互斥的旧配置，避免旧目标继续取得优先级。
4. 浏览器生命周期变更与工具 Job 串行，防止执行期间替换或关闭浏览器。
5. 状态与错误输出支持人工阅读及脚本处理，且不泄露 WebSocket Headers。

### 非目标

- 不恢复 `start`、`stop`、`repl` 等本地 Worker 进程管理命令。
- 不持久化 Worker 浏览器配置；Worker 重启后仍回落到启动种子配置。
- 不修改现有 `/api/browser/*` Web 控制台路由。
- 不返回完整浏览器配置，也不提供通用配置编辑命令。
- 不新增依赖，不修改 `BrowserManager` 的反检测分层或默认行为。
- 不启动真实浏览器做自动化测试。

## 3. 总体架构

```text
proxycli browser ...
        |
        v
WorkerHttpClient
        |
        v
/api/v1/browser/* -- Bearer Auth
        |
        +--> BrowserConfigSchema --> RuntimeConfigStore
        |
        +--> BrowserConnectionManager --> ToolContextProvider
```

### CLI 组件

- 新增 `browserCommand`，解析第一个位置参数 `connect`、`disconnect` 或 `status`。
- `WorkerHttpClient` 增加三个与路由一一对应的方法。
- `app.ts` 注册顶级 `browser` 命令，`help.ts` 提供命令组和子命令用法。

### Worker 组件

- `createApiV1Routes()` 增加三个浏览器路由，并取得现有 `ToolContextProvider`。
- 配置校验复用 `BrowserConfigSchema`；该入口额外拒绝未知字段并校验 URL 协议、互斥项和合并后的目标状态。
- 连接配置以现有 `getBrowserManagerConfig()` 为基线，再覆盖更新后的 `RuntimeConfigStore.browser`。因此本次显式运行时更新可以覆盖环境变量播种值，而无须改变其他配置消费者的全局优先级。
- 连接与断开复用 `connectBrowser()`、`disconnectBrowser()`。
- 状态从 `ToolContextProvider` 的最新 Browser/Context 读取；模式根据当前配置统一解析为 `attach`、`ws-endpoint`、`launch` 或 `disconnected`。

## 4. HTTP API

所有响应继续使用现有 API 信封：成功为 `{success:true,data}`，失败为 `{success:false,error}`。

### `GET /api/v1/browser/status`

返回：

```json
{
  "connected": true,
  "mode": "attach",
  "pages": 2
}
```

- `connected`：当前 Browser 是否仍连接。
- `mode`：`attach`、`ws-endpoint`、`launch` 或 `disconnected`。
- `pages`：当前 BrowserContext 的页面数；无 Context 时为 `0`。
- 不返回浏览器配置、URL、Headers 或凭据。

### `POST /api/v1/browser/connect`

请求体为 `BrowserConfig` 的受支持子集，允许空对象：

```json
{
  "browserURL": "http://127.0.0.1:9222",
  "headless": false
}
```

处理顺序：

1. 校验请求体、受支持字段及字段值。
2. 对连接目标应用互斥清理规则。
3. 检查活动 Job，并在修改配置前取得浏览器操作权。
4. 把增量配置合并到 `RuntimeConfigStore.browser`。
5. 用运行时配置覆盖解析基线后调用 `connectBrowser()`；已有连接时该调用执行显式重连。
6. 返回最新 `{connected, mode, pages}`，并在 `finally` 中释放操作权。

连接失败时返回 `502 BROWSER_CONNECT_FAILED`。已提交的内存配置不回滚，用户修正参数后可直接重试；失败响应不得包含 `wsHeaders`。

### `POST /api/v1/browser/disconnect`

断开并清理 `ToolContextProvider` 中的旧 Browser/Context 引用，返回：

```json
{
  "connected": false,
  "mode": "disconnected",
  "pages": 0
}
```

重复断开保持幂等。断开失败返回 `502 BROWSER_DISCONNECT_FAILED`。

## 5. CLI 接口

```text
proxycli browser connect [options]
proxycli browser disconnect [--json]
proxycli browser status [--json]
```

### `connect` 参数

| CLI 参数                                | 请求字段              | 说明                             |
| --------------------------------------- | --------------------- | -------------------------------- |
| `--browser-url <url>`                   | `browserURL`          | 通过 HTTP(S) DevTools 地址连接   |
| `--ws-endpoint <url>`                   | `wsEndpoint`          | 通过 WS(S) DevTools 地址连接     |
| `--ws-headers <json>`                   | `wsHeaders`           | 字符串键值 JSON 对象，不回显     |
| `--channel <name>`                      | `channel`             | 使用 schema 支持的本地浏览器通道 |
| `--executable-path <path>`              | `executablePath`      | 使用指定本地浏览器程序           |
| `--headless[=true\|false]`              | `headless`            | 控制无头模式                     |
| `--isolated[=true\|false]`              | `isolated`            | 控制临时隔离 profile             |
| `--user-data-dir <path>`                | `userDataDir`         | 指定 profile 目录                |
| `--viewport <宽x高>`                    | `viewport`            | 两个正整数，如 `1280x720`        |
| `--accept-insecure-certs[=true\|false]` | `acceptInsecureCerts` | 是否接受不安全证书               |
| `--cloak[=true\|false]`                 | `cloak`               | 显式启用 CloakBrowser            |
| `--js-stealth[=true\|false]`            | `jsStealth`           | 显式启用 JS stealth 注入         |
| `--minimal-stealth[=true\|false]`       | `minimalStealth`      | 控制最小启动参数集               |
| `--full-stealth-args[=true\|false]`     | `fullStealthArgs`     | 显式启用历史完整参数集           |
| `--json`                                | —                     | 输出结构化 JSON                  |

未传浏览器参数时发送空对象，使用 Worker 当前配置重连。布尔参数未带值时表示 `true`，显式关闭使用 `--flag=false`。

### 参数互斥与目标切换

- `--browser-url` 与 `--ws-endpoint` 互斥。
- `--channel` 与 `--executable-path` 互斥。
- 远程目标不得与 `--channel` 或 `--executable-path` 同时出现。
- 设置 `browserURL` 时把已存 `wsEndpoint` 与隐藏的旧式 `remoteDebuggingUrl` 回退目标清为 `undefined`。
- 设置 `wsEndpoint` 时把已存 `browserURL` 与隐藏的旧式 `remoteDebuggingUrl` 回退目标清为 `undefined`。
- 设置 `channel` 或 `executablePath` 时把已存 `browserURL`、`wsEndpoint` 与 `remoteDebuggingUrl` 都清为 `undefined`。
- 其他参数只增量覆盖对应字段，不清空未传配置。

CLI 先做同样的快速校验以提供直接错误提示；Worker 仍执行完整校验，不能信任客户端。

### 输出

- 默认输出简洁表格，包含 `Connected`、`Mode` 和 `Pages`。
- `--json` 返回结构化命令结果，并包含 `command`、`action`、`connected`、`mode`、`pages`。
- 未知动作、未知参数、缺失参数或冲突参数返回 `VALIDATION_ERROR`、用法建议和非零退出语义。

## 6. 并发与状态约束

浏览器是 Worker 进程级共享资源。`createApiV1Routes()` 在现有活动 Job 状态之外维护一个浏览器操作状态：

- 有活动 Job 时，`connect`/`disconnect` 返回 `409 WORKER_BUSY`。
- 有浏览器操作时，新 Job、`connect` 和 `disconnect` 返回 `409 WORKER_BUSY`。
- 检查并设置浏览器操作状态必须发生在第一次 `await` 之前，避免同一事件循环中的竞态。
- 操作状态在 `finally` 中清理。
- `status` 不参与互斥，始终可读并反映当时的真实状态。

## 7. 校验与错误

| 场景                       | HTTP 状态 | 错误码                      |
| -------------------------- | --------: | --------------------------- |
| 请求体或参数非法           |       400 | `VALIDATION`                |
| 连接目标冲突               |       400 | `BROWSER_CONFIG_CONFLICT`   |
| Job 或浏览器操作占用运行时 |       409 | `WORKER_BUSY`               |
| 浏览器连接失败             |       502 | `BROWSER_CONNECT_FAILED`    |
| 浏览器断开失败             |       502 | `BROWSER_DISCONNECT_FAILED` |
| Bearer Token 缺失或错误    |       401 | `UNAUTHORIZED`              |

边界校验至少包含：

- `browserURL` 使用 `http:` 或 `https:`。
- `wsEndpoint` 使用 `ws:` 或 `wss:`。
- `wsHeaders` 是非数组对象，所有键和值均为字符串。
- viewport 宽高均为正整数。
- channel 必须属于 `BrowserConfigSchema` 的枚举。
- 只接受本设计列出的配置字段；未知字段不得被静默丢弃。

`WorkerHttpClient` 继续负责超时、认证头、非 JSON 响应和 API 错误信封解包；CLI 把错误转换为可操作提示。

## 8. 测试策略

实现遵循 TDD：每组生产代码前先写能因能力缺失而失败的测试，确认失败原因后写最小实现。

### Worker 路由测试

- 连接、断开、页面数和模式状态。
- 空请求体使用当前配置。
- 增量合并与三类目标切换的旧字段清理。
- 显式运行时目标覆盖环境变量播种目标。
- URL、Headers、viewport、枚举、未知字段与冲突矩阵。
- 连接失败后配置保留，错误中不泄露 Headers。
- 已连接时重连、已断开时幂等断开。
- Job 与浏览器操作之间双向 `409 WORKER_BUSY`。

### proxycli 测试

- `WorkerHttpClient` 三个方法的路径、方法、请求体、Bearer Token 与错误解包。
- `browserCommand` 三个动作的分发和参数映射。
- `false` 布尔值、JSON Headers、viewport 解析。
- 参数冲突、未知动作和未知参数。
- 表格与 JSON 输出。
- 顶级注册、帮助列表和子命令用法。

路由测试沿用现有 `BrowserManager` mock 模式；客户端 HTTP 测试使用本地临时服务器，不启动真实浏览器。

## 9. 验收

最终代码修改后运行：

```text
npm --prefix proxycli test
npm --prefix proxycli run typecheck
npm run typecheck
npm run test:unit
npm run check-format
```

最终 diff 必须只包含本功能所需修改，并保留工作区已有的无关改动。任何检查无法运行或仍失败时，明确报告阻塞，不以较早的通过结果代替最终验证。
