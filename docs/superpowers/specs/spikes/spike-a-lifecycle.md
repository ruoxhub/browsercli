# Spike A: ConsoleServer 生命周期调研

> **日期**: 2026-05-26
> **结论**: ✅ **可行，且比规格设想的更简洁**。Worker 进程内并存两个独立 ws 端点没有冲突；现有 EventBus 已经在 emit tool 调用事件，省掉了规格 §6.2 设想的 ToolAdapter EventEmitter 改造。

---

## 1. 摘要

| 维度 | 结论 |
|------|------|
| 嵌入位置 | `src/index.ts` main() 的 `client.start()` 之后、`gracefulShutdown` 注册之前 |
| 关闭顺序 | `consoleServer.close()` → `client.disconnect()` → `contextProvider.dispose()` → `browserManager.close()` → `dbService.disconnect()` |
| 失败隔离 | wrap in try/catch，仅 warn，不抛 — 与 `main().catch(process.exit(1))` 隔离 |
| 双端口拓扑 | RpcClient 是出向 ws 客户端（连 Sekiro:5612），ConsoleServer 是入向 ws+http 监听（127.0.0.1:8765），完全不冲突 |
| CLI 旗标透传 | `worker-manager.ts:173-182` 已有的 args 拼接 + `WorkerArgs.ts:18 VALUE_FLAGS` 各加一项，链路最短 |
| **重大修正** | 规格 §6.2 写"修改 `src/cli/commands/start.ts`"是错的。`start.ts` 是 CLI 进程，spawn 出 Worker 后就退出；要嵌入的是 Worker 进程入口 `src/index.ts` |

---

## 2. Worker 当前启动序列（src/index.ts:34-94）

| 步骤 | 行号 | 调用 | 关键产出 |
|------|------|------|---------|
| 1 | 36-38 | `parseWorkerArgs → resolveConfig → toWorkerOptions` | `options: WorkerStartOptions` |
| 2 | 40-42 | `console.log` | 启动 banner |
| 3 | 44-48 | `dbService.connect + migrate`（可选） | DB 就绪 |
| 4 | 51 | `getRuntime()` | runtime 单例（含 eventBus, hookManager 等）|
| 5 | 54-56 | `browserManager.ensureBrowser` | Browser + BrowserContext |
| 6 | 59-64 | `new ToolContextProvider(runtime); contextProvider.setContext; init` | 数据收集器在线 |
| 7 | 67-70 | `new RpcClient({group, rpcHost})` | 客户端实例（未连）|
| 8 | 73 | `registerBuiltinActions(client)` | 内置 action 注册 |
| 9 | 76-79 | `new ToolAdapter(contextProvider); registerAll` | **135 个 tool 注册到 client.handlers** |
| 10 | 82 | `await client.start()` | **WS 连到 Sekiro，等握手完成**，打印 "已启动..." |
| 11 | 87-93 | `createGracefulShutdown + SIGTERM/SIGINT` | 关闭钩子 |

main() 末尾 `main().catch(err => { console.error; process.exit(1); })`（line 96-99）—— **任何异步抛错都会让 Worker 直接 exit(1)**。

---

## 3. ConsoleServer 嵌入点

**推荐：在第 10 步之后、第 11 步之前**（即 `await client.start()` 之后，`process.on('SIGTERM', ...)` 之前）。

理由：
1. **必须在 step 9 之后**：否则 `/api/tools` 返回空（ToolAdapter 还没扫完 135 个 tool）
2. **不必等到 step 10 完成**：理论上 ConsoleServer 可以在 step 9 之后立刻起来。但这样做会让 `worker.status` WS 频道在第一次广播时拿到 `connectionState=disconnected`，前端首屏不友好。等 step 10 完成后启动，首次 `worker.status` 快照即 `connected`，体验干净。
3. **必须在 step 11 之前注册**：`createGracefulShutdown` 需要持有 `consoleServer` 引用以便关闭。

伪代码：

```typescript
// src/index.ts (修改后的 main 末尾)
await client.start();                                     // step 10
console.log('[Worker] 已启动并连接到 Rpc Server');        // 现状

// === 新增：ConsoleServer 启动（失败不阻塞）===
let consoleServer: ConsoleServer | null = null;
if (!options.disableWeb) {
  try {
    consoleServer = new ConsoleServer({
      port: options.webPort ?? 8765,
      host: '127.0.0.1',
      runtime,
      contextProvider,
      client,
      toolAdapter,                                        // ← 见 §10 直连入口
    });
    await consoleServer.listen();
    console.log(`[Worker] 控制台 http://127.0.0.1:${consoleServer.port}`);
  } catch (err) {
    console.warn('[Worker] ConsoleServer 启动失败，CLI 继续运行:', err);
    consoleServer = null;
  }
}

const gracefulShutdown = createGracefulShutdown({
  browserManager: runtime.browserManager,
  client,
  contextProvider,
  consoleServer,                                          // ← 注入
});
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

---

## 4. 关闭顺序设计

### 4.1 当前 createGracefulShutdown（src/worker/WorkerLifecycle.ts:36-79）

```
SIGTERM/SIGINT
  ├─ L51 client.disconnect()              // 停止 Sekiro WS（同步）
  ├─ L53-60 contextProvider.dispose()     // 释放 PageManager / DataCollectors / DebuggerSessions
  ├─ L62-67 browserManager.close() (10s timeout)
  ├─ L69-74 database.disconnect() (10s timeout)
  └─ L77 exit(0)
```

### 4.2 ConsoleServer 应插入位置

**在 L51 之前**，作为最优先关闭项：

```
SIGTERM/SIGINT
  ├─ (新) consoleServer.close()           // 关 HTTP + WS，主动断开浏览器连接
  ├─ L51 client.disconnect()
  ├─ L53-60 contextProvider.dispose()
  ├─ L62-67 browserManager.close()
  ├─ L69-74 database.disconnect()
  └─ L77 exit(0)
```

理由：
1. ConsoleServer 是**面向用户的 UI**。先关它，让浏览器立刻看到"Worker 已停止"，避免页面继续轮询 + 前端误以为是网络故障。
2. ConsoleServer 内部的 WS 客户端可能还在订阅 `tool.invoke` 事件 —— 如果先关 client/runtime，HookManager / ToolTelemetry 在 dispose 阶段还可能 emit 事件，触发 ConsoleServer 向已关闭的 socket 写入，产生 EPIPE 噪音。
3. close 是同步、快速操作（关 listening server + 关所有 ws 连接），不需要 timeout。

实现：`createGracefulShutdown` 加一个可选参数 `consoleServer?: { close: () => Promise<void> }`；若提供，在最前面 `try { await consoleServer.close(); }`，失败仅 log 不抛。

---

## 5. 失败隔离策略

### 5.1 问题
`main().catch` 会把任何抛错转成 exit(1)。如果 ConsoleServer 启动失败（端口占用、bind EACCES、moduleResolveError），Worker 会被一并打死，让 CLI 用户疑惑"为什么我没启用 Web 也连不上 worker"。

### 5.2 推荐
**在嵌入点用本地 try/catch 兜住**：

```typescript
try {
  await consoleServer.listen();
} catch (err) {
  console.warn('[Worker] ConsoleServer 启动失败，CLI 继续运行:', err);
  consoleServer = null;
}
```

3 种典型失败：
- `EADDRINUSE`（端口占用） — 提示用户使用 `--web-port` 或排查 8765
- `EACCES`（绑定权限） — 极少发生（127.0.0.1 + ≥1024 端口）
- 模块加载失败（apps/web/dist 不存在等） — dev 模式下 vite 反代会兜底，prod 模式下打 banner 警告

### 5.3 与 `main().catch` 兼容
本地 catch 后 `consoleServer = null`，main() 主流程不抛错，process 不退出。`gracefulShutdown` 收到 `null` 时跳过 close 调用即可。

### 5.4 不推荐的方案
**不要**给 main().catch 改逻辑（让它对某些错误降级）。这会污染所有抛错的语义判断。把 ConsoleServer 的失败处理就近收掉，main 保持"启动完毕 = 启动成功"的契约。

---

## 6. 双端口并存可行性

### 6.1 RpcClient（出向 ws，src/protocol/Client.ts）
- 第 248 行 `new WebSocket(this.wsURL)` —— 是**客户端**，连接 Sekiro Server
- 第 33-66 行：维护单个 `socket`、心跳定时器、重连退避
- 第 36 行：`handlers = new Map<string, ActionHandler>()` —— 这是工具注册表，与端口无关
- **不持有任何全局/单例资源**：没有 `process.on('uncaughtException')`、没有改 fs 句柄、没有 monkey-patch 全局 fetch

### 6.2 ConsoleServer（入向 http+ws，新增）
- 类似 `scripts/debugger-lab/server.mjs`：`createServer + WebSocketServer({noServer:true}) + server.on('upgrade')`
- 监听 `127.0.0.1:8765`
- 进程内独立的资源池（自己的 server / wss / sockets Map）

### 6.3 冲突排查
| 资源 | RpcClient | ConsoleServer | 冲突？ |
|------|-----------|---------------|--------|
| 端口 | 客户端，无 | listen 8765 | ❌ 否（出/入向不同）|
| WS 库 | `import WebSocket from 'ws'` | `import {WebSocketServer} from 'ws'` | ❌ 否（同库不同导出，互不冲突）|
| 全局变量 | 无 | 无 | ❌ 否 |
| stdin/stdout | 无 | 无（HTTP 走 socket）| ❌ 否 |
| 信号处理 | 无 | 无（信号在 main 中统一注册）| ❌ 否 |

**结论：无冲突**。两个 ws 端点在同一进程内并存是 Node.js 的常见模式，debugger-lab 自身就是这种模式（http server + WebSocketServer）。

---

## 7. CLI → Worker 旗标透传链路

### 7.1 当前链路（src/cli/worker-manager.ts:173-192）

```typescript
const workerArgs: string[] = [
  '--rpcHost', options.rpcHost,
  '--group', options.group,
];
if (options.browserUrl) workerArgs.push('--browserUrl', options.browserUrl);
if (options.wsEndpoint) workerArgs.push('--wsEndpoint', options.wsEndpoint);
if (options.headless) workerArgs.push('--headless');
if (options.executablePath) workerArgs.push('--executablePath', options.executablePath);
if (options.databaseUrl) workerArgs.push('--databaseUrl', options.databaseUrl);

this.workerProcess = spawn(execPath, [workerEntry, ...workerArgs], {
  stdio: ['ignore', 'pipe', 'pipe'],
  // ...
  env: {...process.env},
});
```

**走 spawn argv，不走 IPC，不走环境变量**（`env: {...process.env}` 只是透传父进程环境）。

### 7.2 Worker 端解析（src/worker/WorkerArgs.ts:18）

```typescript
const VALUE_FLAGS: Record<string, keyof GlobalConfig> = {
  '--browserUrl': 'browserUrl',
  '--databaseUrl': 'databaseUrl',
  '--executablePath': 'executablePath',
  '--group': 'group',
  '--rpcHost': 'rpcHost',
  '--wsEndpoint': 'wsEndpoint',
};
```

行 35-38 处理 `--headless`（boolean），行 41-44 对未知参数 `console.warn` 但不报错。

### 7.3 推荐的旗标设计

| CLI 旗标 | 类型 | 默认 | 用途 |
|----------|------|------|------|
| `--no-web` | boolean | false | 禁用 ConsoleServer |
| `--web-port <n>` | number | 8765 | 自定义端口 |

**用 CLI args，不用环境变量**，三个理由：
1. 与现有 6 个 flag 风格一致（不引入新模式）
2. 多 Worker 实例（未来）想各自不同端口时，args 是显式的；env 容易污染父子进程
3. CLI 命令行的可观察性 — `ps aux | grep js-reverse` 能直接看到端口

### 7.4 需要改的文件

1. **`src/types/platform.ts`**：`WorkerStartOptions` 加 `disableWeb?: boolean; webPort?: number;`
2. **`src/cli/worker-manager.ts:173-182`**：拼接 args 时附加新两项（`if (options.disableWeb) workerArgs.push('--no-web')`、`if (options.webPort) workerArgs.push('--web-port', String(options.webPort))`）
3. **`src/worker/WorkerArgs.ts:18`**：
   - VALUE_FLAGS 加 `'--web-port': 'webPort'`（注意 GlobalConfig 也得加 webPort 字段）
   - L35-38 风格加 `if (arg === '--no-web') { cliConfig.disableWeb = true; continue; }`
4. **`src/cli/commands/start.ts`**（仅 CLI 旗标识别，不直接启 ConsoleServer）：解析 `--no-web` / `--web-port` 并传给 `workerManager.start({ ..., disableWeb, webPort })`
5. **`src/config.ts`**（GlobalConfig）：加 `disableWeb?: boolean; webPort?: number;` 两个可选字段
6. **`src/index.ts`**：从 `options` 读取 `disableWeb` / `webPort`，按 §3 嵌入

---

## 8. 实施 diff 草图

> 仅伪代码，标关键改动行，不要 plan 阶段照搬。

**`src/index.ts`**（在 line 84 后插入约 15 行）：

```diff
   await client.start();
   console.log('[Worker] 已启动并连接到 Rpc Server');

+  let consoleServer: ConsoleServer | null = null;
+  if (!options.disableWeb) {
+    try {
+      consoleServer = new ConsoleServer({
+        port: options.webPort ?? 8765,
+        host: '127.0.0.1',
+        runtime,
+        contextProvider,
+        client,
+        toolAdapter,
+      });
+      await consoleServer.listen();
+      console.log(`[Worker] 控制台 http://127.0.0.1:${consoleServer.port}`);
+    } catch (err) {
+      console.warn('[Worker] ConsoleServer 启动失败:', err);
+    }
+  }
+
   const gracefulShutdown = createGracefulShutdown({
     browserManager: runtime.browserManager,
     client,
     contextProvider,
+    consoleServer,
   });
```

**`src/worker/WorkerLifecycle.ts`**（11 → ~20 行，加 console close 优先项）：

```diff
   interface ShutdownDependencies {
     browserManager: BrowserManager;
     client: RpcClient;
     contextProvider?: {dispose(): void};
+    consoleServer?: {close(): Promise<void>} | null;
     database?: Pick<typeof dbService, 'disconnect'>;
     // ...
   }

   // 在 client.disconnect() 之前
+  if (consoleServer) {
+    try {
+      await withTimeout(consoleServer.close(), 3000, '关闭 ConsoleServer 超时');
+      console.log('[Worker] ConsoleServer 已关闭');
+    } catch (err) {
+      console.error('[Worker] 关闭 ConsoleServer 失败:', err);
+    }
+  }
   client.disconnect();
```

---

## 9. 未解决问题（plan 阶段需澄清）

1. **dev 模式反代**：规格 §2.1 说 ConsoleServer 在 dev 模式下反代 5173 到 vite。这要求 worker 进程能感知"现在是 dev 还是 prod"。建议用环境变量 `JS_REVERSE_WEB_DEV=1` 或检查 `apps/web/dist` 是否存在 —— 待 plan 决定。
2. **静态资源路径**：prod 模式下 `apps/web/dist` 相对 worker 进程的位置是 `<repo>/apps/web/dist/`。打包发布（`build/` 目录）时，这条路径会变。`files` 字段当前不包含 `apps/web/dist`，需在 P0-D1 加上。
3. **ConsoleServer.listen 超时上限**：建议 5s，超时则按失败处理。Plan 阶段确认。
4. **`registerBuiltinActions` 是否注入了 ConsoleServer 需要的 action**：本 spike 没读 BuiltinActions.ts，留作 plan 时核查。

---

## 10. 关键洞见（与规格分歧）

| 规格说法 | 现状 | 修正 |
|---------|------|------|
| §6.2 "修改 `src/cli/commands/start.ts` 接入 ConsoleServer" | start.ts 是 CLI 进程，spawn 完 Worker 后立即返回 | 应改 `src/index.ts`（Worker 进程入口）|
| §11 风险表 "现有 ToolAdapter 没有 invoke hook 钩子，需加 EventEmitter" | `runtime.eventBus` 已有 `tool:called` / `tool:error` 事件，由 ToolTelemetry emit（src/worker/ToolTelemetry.ts:27, 36）| **不需要**改 ToolAdapter，直接订阅 eventBus |
| §6.2 "通过 `ToolResponseAccumulator` 的回调点接入" | ToolResponseAccumulator 是 normalize 工具，没有回调点 | 走 EventBus 即可，不动 Accumulator |

详见 [[spike-b-reuse-map]] 的"数据流 2"与"数据流 4"。
