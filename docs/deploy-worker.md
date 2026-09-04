# 运行 Worker Daemon 服务

本指南说明如何运行 `js-reverse-worker`（`src/index.ts` 进程）作为**本地 daemon**，
并让 CLI `browsercli` 通过本地命名管道（POSIX 为 unix socket）以 NDJSON 行协议调用它。

这是 2026-09-04 传输改造的产物：旧的 `/api/v1` HTTP 契约与 Sekiro RPC 路径均已删除，
CLI 与 worker 的通信模型对齐 playwright-cli —— **workspace 作用域的多会话 daemon + 自动拉起**。
跨网络远程部署不再由本仓库支持。

> 文档中的所有行为描述均对应**已落地的代码**（`src/ipc/`、`browsercli/src/daemonClient.ts`）。

## 1. 概述

- **Daemon**（`node build/src/index.js --daemon`）监听命名管道
  `\\.\pipe\browsercli-<workspaceHash16>-<session>`（POSIX：`$TMPDIR/browsercli-<hash16>-<session>.sock`），
  按 NDJSON 行协议处理 `{id, method, params}` 请求并返回 `{id, result}` / `{id, error}`。
- **CLI**（`browsercli <command>`）按 workspace-hash 注册表发现会话；连不上就自动
  `spawn` 一个 detached daemon，并等子进程 stdout 的精确就绪行
  `Daemon listening on <socketPath>` 完成握手。
- **Web 控制台**保留但只绑 `127.0.0.1`：`default` 会话固定 `8765`，其余会话用临时端口，
  实际端口写入 session 文件（`browsercli list` / status 可查）。

## 2. 启动方式

### 自动拉起（推荐）

无需手动启动 daemon，直接：

```bash
browsercli open              # 拉起 default 会话（含 Web 控制台 8765）
browsercli -s=proj open      # 拉起名为 proj 的第二会话（临时控制台端口）
```

`open` 之外的一切命令（`call` / `browser` / `jobs` / …）在目标会话未运行时也会自动拉起。

### 手动前台启动（调试用）

```bash
node build/src/index.js --daemon --session default [--console-port 8765] [--no-console]
```

daemon 专属参数（`src/ipc/daemonArgs.ts`）：

| 参数                  | 说明                                                           |
| --------------------- | -------------------------------------------------------------- |
| `--daemon`            | 进入 daemon 模式（否则是 MCP stdio 模式）                      |
| `--session <name>`    | 会话名；缺省取 `BROWSERCLI_SESSION` 环境变量，再缺省 `default` |
| `--no-console`        | 不启动回环 Web 控制台                                          |
| `--console-port <p>`  | 覆盖控制台端口（空格与 `=` 两种形式均可）                      |
| `--browsercli-daemon` | 由 CLI spawn 时自动携带；`kill-all` 靠该标记识别进程           |

### 会话命令

```bash
browsercli list            # 列出注册表中全部会话（Session/PID/Console/Status）
browsercli close           # 停止当前会话（-s=<name> 指定）
browsercli kill-all        # 强杀全部 browsercli daemon 进程 + 清理 stale 会话文件
```

## 3. 环境变量

| 变量                    | 默认值         | 说明                                                               |
| ----------------------- | -------------- | ------------------------------------------------------------------ |
| `BROWSERCLI_DAEMON_DIR` | 平台注册表目录 | 覆盖会话注册表目录（测试隔离用）                                   |
| `BROWSERCLI_SESSION`    | `default`      | 默认会话名                                                         |
| `BROWSERCLI_ENTRY`      | —              | daemon 入口 js 路径；未设时读 `browsercli config` 的 `workerEntry` |

注册表目录默认值：win32 `%LOCALAPPDATA%\browsercli\daemon`，linux
`$XDG_CACHE_HOME || ~/.cache` + `/browsercli/daemon`，darwin `~/Library/Caches/browsercli/daemon`。
其下按 `workspaceHash16`（`sha1(workspaceRoot)` 前 16 位）分子目录，每会话一个
`<name>.session` JSON 文件（含 `socketPath`/`pid`/`consolePort`/`protocol`）。

workspaceRoot 探测：从 cwd 向上最多 10 级找含 `.browsercli/` 的目录，否则找
`package.json`，都没有用 cwd。CLI 与 daemon 两侧算法必须同步（注释互指）。

## 4. 协议速查

方法集（`src/ipc/daemonServer.ts`）：

| 方法                 | 参数             | 说明                                                     |
| -------------------- | ---------------- | -------------------------------------------------------- |
| `hello`              | —                | `{version, protocol, pid, session, uptimeMs}`            |
| `tools.list`         | —                | `{tools}`                                                |
| `tool.invoke`        | `{tool, params}` | 同步请求-响应（客户端默认超时 300s）；忙回 `WORKER_BUSY` |
| `browser.status`     | —                | 浏览器连接状态                                           |
| `browser.connect`    | `{body}`         | 更新配置并连接浏览器（忙判定同旧 apiV1）                 |
| `browser.disconnect` | `{body:{force}}` | 断连；force 会中止活动 job                               |
| `jobs.list`          | —                | `{jobs}`                                                 |
| `jobs.cancel`        | `{jobId}`        | abort + 1s 宽限 + 必要时强制终结                         |
| `subscribe`          | `{channels}`     | 该连接接收 WsHub 事件推送（`--watch` 用）                |
| `stop`               | —                | 回 `{result:'ok'}` 后删 session 文件、关管道、退出进程   |

语义要点：

- **WORKER_BUSY**：daemon 维持「单活动 job」约束，CLI 端按 `[200, 500, 1000]`ms 退避重试。
- **断线中止**：客户端 socket 断开 ⇒ 中止该连接上运行中的 job（`AbortController`）。
- **协议协商**：`PROTOCOL_VERSION = 1` 在 `src/ipc/socketConnection.ts` 与
  `browsercli/src/daemonClient.ts` 两侧各定义一份（零耦合、注释互指）；不匹配时报错并提示
  `close` + 重新 `open`。
- **就绪握手**：spawn 后只认 stdout 的 `Daemon listening on <pipePath>` 行；子进程提前退出
  ⇒ 读 `<session>.err` 拼进错误信息。

## 5. 已知限制

1. **不支持跨网络部署**：管道/socket 是本机 IPC；Web 控制台仅绑 `127.0.0.1`。
2. **`runtimeConfigPersistence` 缓存文件全局共享**：多会话会读到同一份上次连接配置。
3. **daemon 无空闲自杀计时器**：生命周期靠 `close` / `kill-all` 管理。
