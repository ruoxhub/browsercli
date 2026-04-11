# DOMAIN KNOWLEDGE — src/daemon/

## OVERVIEW

Unix Socket 服务端与 IPC 客户端，构成 CLI ↔ Daemon ↔ MCP-Server 三层架构的通信中枢。

## WHERE TO LOOK

| Task            | Location                                    | Notes                                              |
| --------------- | ------------------------------------------- | -------------------------------------------------- |
| 请求路由分发    | `daemon.ts:handleRequest()`                 | 60+ 工具调度中枢，按 `msg.method` 分支             |
| Socket 服务启动 | `daemon.ts:startSocketServer()`             | `node:net.createServer`，监听 tmp 目录 socket 文件 |
| 工具懒加载      | `daemon.ts:ensureToolsLoaded()`             | `_toolsLoaded` flag + `_loadToolsPromise` 防并发   |
| 浏览器生命周期  | `daemon.ts:ensureBrowserConnection()`       | `setTimeout(..., 100)` 异步启动，不阻塞 socket     |
| 信号清理        | `daemon.ts:cleanup()`                       | SIGTERM/SIGINT 优雅关闭，SIGHUP 显式忽略           |
| PID 文件管理    | `daemon.ts` + `utils.ts`                    | 启动写 PID，清理删文件，防重复启动                 |
| CLI 客户端      | `client.ts:startDaemon()` / `sendCommand()` | spawn detached 进程 + poll socket 就绪             |
| HTTP API 桥接   | `http-server.ts:createHttpServer()`         | Express 包装 `sendCommand()`，提供 REST 入口       |
| 跨平台适配      | `utils.ts:IS_WINDOWS`                       | Windows 用 named pipe，Unix 用 domain socket       |
| 消息协议        | `types.ts`                                  | `DaemonMessage` / `DaemonResponse` 格式定义        |

## CONVENTIONS

- **响应构造**: `handleRequest()` 内联构建 `response` 对象，用 `_lines`、`_includePages` 等私有字段累积结果，最终 `JSON.stringify` 返回
- **NetworkCollector 全局实例**: `_networkCollector` 在 daemon 级别初始化，所有工具共享同一收集器
- **Page 缓存策略**: `handleRequest()` 预取 `cachedPages` 数组，工具调用中 `getPages()` 同步返回，避免 Promise 竞态
- **Socket 协议**: 每条消息以 `\0` (null byte) 分隔，`client.ts` 解析时需 trim + 截断
- **超时保护**: `sendCommand()` 设 30s 超时，到期 `socket.destroy()` 并抛异常
- **跨平台 spawn**: Windows 用 `shell: true` + `windowsHide`，Unix 用 `nohup`，均 `detached: true` + `stdio: 'ignore'`

## ANTI-PATTERNS

- **NEVER** 在 `handleRequest()` 中直接 `import` 工具模块 — 必须走 `getCachedTools()` 懒加载
- **NEVER** 移除 `setTimeout(..., 100)` 浏览器连接延迟 — 这是避免阻塞主事件循环的有意设计
- **NEVER** 忽略 SIGHUP 信号处理 — 缺少会导致父进程退出时意外触发 cleanup
- **NEVER** 用 `accessSync` 替代 `statSync().isSocket()` 判断 socket 就绪 — 文件存在不等于可连接
- **DON'T** 在 `context` 对象中省略 stub 方法 — 工具 handler 期望完整接口，缺方法会抛 `TypeError`
- **DON'T** 手动删除 PID 文件而不走 `cleanup()` — 会导致状态不一致，下次启动误判为"已在运行"
