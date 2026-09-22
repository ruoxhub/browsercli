# 本地 Socket + Detached Daemon IPC 改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 browsercli ↔ worker 的通信从 HTTP `/api/v1` 换成「本地命名管道 + detached daemon 自动拉起」模型（对齐 playwright-cli），并彻底删除 Sekiro RPC 路径。

**Architecture:** worker 以 daemon 模式启动时监听 Windows 命名管道（POSIX 用 unix socket），NDJSON 行协议做 `{id, method, params}` 请求/响应；CLI 侧按 workspace-hash 注册表（`%LOCALAPPDATA%\browsercli\daemon\<hash>\<name>.session`）发现会话，连不上就自动 spawn detached daemon 并等 stdout 就绪行。Web 控制台保留，只绑 127.0.0.1：default 会话固定 8765，其余会话用临时端口并记录到 session 文件。

**Tech Stack:** Node `net`（命名管道/unix socket）、`child_process.spawn`、`node:test`；无新增运行时依赖。

**Spec:** 本计划即设计文档（决策来自 2026-09-03 用户确认：裸 JSON socket 协议 / 保留回环 Web 控制台 / 多会话 + 自动拉起）。

## Global Constraints

- Node `^20.19.0 || ^22.12.0 || >=23`；TypeScript ESM，导入带 `.js` 后缀、`node:` 前缀、显式 type import、按 ESLint 字母序分组。
- Prettier：`singleQuote`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`。
- 不新增任何运行时依赖（`net`/`child_process`/`crypto` 均 stdlib；browsercli 已有 `ws` 但改造后 socket 路径不再需要新库）。
- 协议版本号 `PROTOCOL_VERSION = 1` 在 `src/ipc/` 与 `browsercli/src/` 两侧各定义一份（两包零耦合，靠注释互指保持同步）；不匹配时报错并给出 `close` + 重新 `open` 的恢复命令。
- 测试镜像目录：`src/ipc/Foo.ts` ↔ `tests/unit/ipc/Foo.test.ts`；browsercli 测试在 `browsercli/tests/unit/`。
- 每结束一个 Task 提交一次，Conventional Commits（`feat(ipc):`、`refactor(web):`、`chore(cli):` 等），不加 agent 署名。
- 已知限制（明确接受，不做过度设计）：`runtimeConfigPersistence` 缓存文件全局共享，多会话会读到同一份上次连接配置；daemon 无空闲自杀计时器，靠 `close`/`kill-all` 管理生命周期。

## 会话与协议设计（所有 Task 共享的语境）

**管道地址**：win32 `\\.\pipe\browsercli-<hash16>-<session>`；POSIX `path.join(os.tmpdir(), 'browsercli-<hash16>-<session>.sock')`（启动前 unlink 残留）。`<hash16>` = `sha1(workspaceRoot).hex.slice(0,16)`。

**workspaceRoot**：从 cwd 向上最多 10 级找含 `.browsercli` 目录的层级，否则回退 `package.json` 所在层，都没有则用 cwd。CLI 侧与 daemon 侧必须用同一算法（daemon spawn 时 cwd 即 CLI 的 cwd）。

**注册表目录**：win32 `%LOCALAPPDATA%\browsercli\daemon`；linux `$XDG_CACHE_HOME || ~/.cache` + `/browsercli/daemon`；darwin `~/Library/Caches/browsercli/daemon`；env `BROWSERCLI_DAEMON_DIR` 覆盖（测试用）。会话文件名 `<session>.session`（JSON），字段：

```ts
interface SessionConfig {
  name: string; version: string; protocol: number; timestamp: number;
  socketPath: string; pid: number; workspaceDir?: string; consolePort?: number;
}
```

**行协议（NDJSON）**：
- 请求 `{id, method, params?}`；响应 `{id, result?}` 或 `{id, error: {code, message, details?}}`；推送（无 id）直接转发 WsHub 的 `ServerMsg`：`{type:'event'|'snapshot'|'error'|'pong', channel?, payload?, ts}`。
- 方法集：`hello` / `tools.list` / `tool.invoke` / `browser.status` / `browser.connect` / `browser.disconnect` / `jobs.list` / `jobs.cancel` / `subscribe` / `stop`。
- `tool.invoke` 为同步请求-响应（默认客户端超时 300s）；客户端 socket 断开 ⇒ 中止该连接上运行中的 job（`AbortController`，对齐 playwright `connection.onclose → abort`）。
- `WORKER_BUSY` 语义保留：daemon 仍维持「单活动 job」约束，CLI 端退避重试 `[200, 500, 1000]`ms。
- daemon 就绪握手：spawn 后监听子进程 stdout，收到 `Daemon listening on <pipePath>` 行才算成功；子进程提前退出 ⇒ 读 `<session>.err` 拼进错误信息。

---

## File Structure

| 动作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/ipc/socketConnection.ts` | NDJSON 帧 + 协议类型 + `PROTOCOL_VERSION` |
| 新建 | `src/ipc/registry.ts` | 注册表路径/workspaceHash/session 文件读写、`killAllDaemons` 之外的发现逻辑 |
| 新建 | `src/ipc/daemonServer.ts` | net server + 方法分发（复用 ToolAdapter/JobStore/WsHub/BrowserConnectionManager） |
| 新建 | `src/worker/browserRequests.ts` | 从 apiV1.ts 抽出的 `parseBrowserConnectBody`/`parseBrowserDisconnectBody`/`effectiveBrowserConfig` |
| 修改 | `src/index.ts` | `--daemon` 分支、就绪行输出、stop 处理 |
| 修改 | `src/web/ConsoleServer.ts` | 删 apiV1/bearerAuth/invoker；接受注入 wsHub；暴露实际端口 |
| 修改 | `src/worker/WorkerArgs.ts` | 增加 `--daemon/--session/--browsercli-daemon`，删除 `--group/--rpcHost` |
| 删除 | `src/worker/SekiroInvoker.ts`、`src/types/rpc.ts`、`src/web/routes/apiV1.ts`、`src/web/middleware/bearerAuth.ts` 及对应测试 | 远程路径下线 |
| 新建 | `browsercli/src/daemonClient.ts` | 客户端连接、ensure/spawn/stop、kill-all、注册表读取 |
| 新建 | `browsercli/src/sessionPaths.ts` | 与 src/ipc/registry.ts 同步的路径/哈希计算（注释互指） |
| 修改 | `browsercli/src/{app,types,help}.ts`、`commands/*` | 全部命令切到 daemon 客户端；新增 open/close/list/kill-all |
| 删除 | `browsercli/src/WorkerHttpClient.ts` 及其测试 | HTTP 客户端下线 |
| 修改 | 文档/脚本：`CLAUDE.md`、`package.json` scripts、`README`（提及处） | 契约描述同步 |

---

### Task 1: socket 帧协议 `src/ipc/socketConnection.ts`

**Files:**
- Create: `src/ipc/socketConnection.ts`
- Test: `tests/unit/ipc/socketConnection.test.ts`

**Interfaces:**
- Produces: `class SocketConnection { constructor(socket: net.Socket); onmessage?: (msg: DaemonMessage) => void; onclose?: () => void; send(message: object): Promise<void>; close(): void }`；类型 `DaemonRequest {id; method; params?}`、`DaemonResponse {id; result?; error?}`；常量 `PROTOCOL_VERSION = 1`；helper `pipePath(socketPath: string): string`（win32 返回 `\\\\.\\pipe\\${name}`，POSIX 返回传入路径）。

- [ ] **Step 1: 写失败测试**

`tests/unit/ipc/socketConnection.test.ts`（node:test，起一对 `net` socket 用内存管道 `net.createServer` + 随机 unix/pipe 路径太长，改用 `socketPair()`：`const server = net.createServer(...)` listen 到 `pipePath('browsercli-test-' + Date.now())`，测试后 close+unlink）：

```ts
import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { SocketConnection, pipePath } from '../../../src/ipc/socketConnection.js';

function tempPipe(): string {
  return pipePath(`browsercli-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

test('sends and receives NDJSON messages', async () => {
  const path = tempPipe();
  const received: unknown[] = [];
  const server = net.createServer(s => {
    const conn = new SocketConnection(s);
    conn.onmessage = m => { received.push(m); conn.send({ id: (m as {id:number}).id, result: 'pong' }); };
  });
  await new Promise<void>(r => server.listen(path, r));
  const client = new SocketConnection(net.createConnection(path));
  const reply = await Promise.race([
    new Promise<unknown>(r => { client.onmessage = r; }),
    new Promise(r => setTimeout(() => r('timeout'), 2000)),
  ]);
  await client.send({ id: 1, method: 'hello' });
  assert.deepEqual(reply, { id: 1, result: 'pong' });
  assert.deepEqual(received, [{ id: 1, method: 'hello' }]);
  client.close(); server.close();
});

test('reassembles a message split across data chunks', async () => {
  const path = tempPipe();
  const server = net.createServer(s => {
    const conn = new SocketConnection(s);
    conn.onmessage = m => { conn.send({ id: (m as {id:number}).id, result: 'ok' }); };
  });
  await new Promise<void>(r => server.listen(path, r));
  const sock = net.createConnection(path);
  await new Promise<void>(r => sock.once('connect', () => r()));
  sock.write('{"id":1,"me');
  await new Promise(r => setTimeout(r, 50));
  sock.write('thod":"x"}\n');
  const conn = new SocketConnection(sock);
  const got = await new Promise<unknown>(r => { conn.onmessage = r; });
  assert.deepEqual(got, { id: 1, result: 'ok' });
  conn.close(); server.close();
});

test('onclose fires when peer destroys', async () => {
  const path = tempPipe();
  let closed = 0;
  const server = net.createServer(s => {
    const conn = new SocketConnection(s);
    conn.onclose = () => { closed++; };
  });
  await new Promise<void>(r => server.listen(path, r));
  const c1 = new SocketConnection(net.createConnection(path));
  await new Promise(r => setTimeout(r, 100));
  c1.close();
  await new Promise(r => setTimeout(r, 200));
  assert.ok(closed >= 1);
  server.close();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/socketConnection.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/ipc/socketConnection.ts`（照抄 playwright 的帧逻辑并收窄类型，见 `open-source/playwright/packages/playwright-core/src/tools/utils/socketConnection.ts`）：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NDJSON socket 帧协议。与 browsercli/src/daemonClient.ts 中客户端配对，
 * PROTOCOL_VERSION 两侧必须同步修改。
 */

import net from 'node:net';

export const PROTOCOL_VERSION = 1;

/** 根 package.json version；与 browsercli 各自独立版本化，兼容性只看 PROTOCOL_VERSION。 */

export interface DaemonRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface DaemonError {
  code: string;
  message: string;
  details?: unknown;
}

export interface DaemonResponse {
  id: number;
  result?: unknown;
  error?: DaemonError;
}

export type DaemonMessage = DaemonRequest | DaemonResponse | Record<string, unknown>;

export function pipePath(name: string): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : name;
}

export class SocketConnection {
  private readonly socket: net.Socket;
  private readonly pendingBuffers: Buffer[] = [];

  onmessage?: (message: DaemonMessage) => void;
  onclose?: () => void;

  constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', buffer => this.onData(buffer));
    socket.on('close', () => this.onclose?.());
    socket.on('error', () => {
      /* close 事件会随后触发；此处保持不抛出，行为对齐 playwright */
    });
  }

  send(message: object): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(`${JSON.stringify(message)}\n`, err =>
        err ? reject(err) : resolve(),
      );
    });
  }

  close(): void {
    this.socket.destroy();
  }

  private onData(buffer: Buffer): void {
    let end = buffer.indexOf('\n');
    if (end === -1) {
      this.pendingBuffers.push(buffer);
      return;
    }
    this.pendingBuffers.push(buffer.subarray(0, end));
    this.dispatch(Buffer.concat(this.pendingBuffers).toString());
    let start = end + 1;
    end = buffer.indexOf('\n', start);
    while (end !== -1) {
      this.dispatch(buffer.toString(undefined, start, end));
      start = end + 1;
      end = buffer.indexOf('\n', start);
    }
    this.pendingBuffers.length = 0;
    if (start < buffer.length) this.pendingBuffers.push(buffer.subarray(start));
  }

  private dispatch(line: string): void {
    if (!line) return;
    try {
      this.onmessage?.(JSON.parse(line) as DaemonMessage);
    } catch {
      // 非法行直接丢弃：协议双方都是本仓库产物，出现脏数据时静默比崩溃好
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/socketConnection.test.js`
Expected: PASS ×3

- [ ] **Step 5: 格式 + 提交**

```bash
npx prettier --write src/ipc/socketConnection.ts tests/unit/ipc/socketConnection.test.ts
npm run typecheck
git add src/ipc/socketConnection.ts tests/unit/ipc/socketConnection.test.ts
git commit -m "feat(ipc): add NDJSON socket frame protocol"
```

---

### Task 2: 会话注册表 `src/ipc/registry.ts`

**Files:**
- Create: `src/ipc/registry.ts`
- Test: `tests/unit/ipc/registry.test.ts`

**Interfaces:**
- Consumes: Task 1 `pipePath`、`PROTOCOL_VERSION`
- Produces:

```ts
export interface SessionConfig { name; version; protocol; timestamp; socketPath; pid; workspaceDir?: string; consolePort?: number }
export interface SessionFile { file: string; daemonDir: string; config: SessionConfig }
export interface ClientInfo { version: string; workspaceDir: string; workspaceDirHash: string; daemonDir: string }
export function computeWorkspaceDir(startDir: string): string
export function computeClientInfo(startDir?: string): ClientInfo   // 含 BROWSERCLI_DAEMON_DIR 覆盖
export function makePipePath(dirHash: string, sessionName: string): string
export function resolveSessionName(name?: string): string           // name || BROWSERCLI_SESSION || 'default'
export function explicitSessionName(name?: string): string | undefined
export async function saveSessionFile(info: ClientInfo, config: SessionConfig): Promise<SessionFile>
export async function loadSessionFile(info: ClientInfo, name: string): Promise<SessionFile | undefined>
export async function listSessionFiles(info: ClientInfo): Promise<SessionFile[]>
export async function deleteSessionFile(sf: SessionFile): Promise<void>
```

- [ ] **Step 1: 写失败测试**

`tests/unit/ipc/registry.test.ts`，用 `BROWSERCLI_DAEMON_DIR` + 临时目录覆盖，断言：

```ts
// 关键用例（每个 test 独立 temp dir，t.after 清理）：
// 1. computeWorkspaceDir：造 tmp/a/.browsercli/ 与 tmp/a/b/c/，从 c 出发命中 tmp/a；
//    无标记目录时向上命中含 package.json 的层；全无则返回 startDir 本身。
// 2. computeClientInfo：workspaceDirHash 为 sha1(workspaceDir) 前 16 位（用 node:crypto 独立算一遍比对）；
//    BROWSERCLI_DAEMON_DIR 生效时 daemonDir 即该值。
// 3. makePipePath('abc123','default') 在 win32 以 '\\\\.\\pipe\\browsercli-abc123-default' 断言，
//    其余平台以 .sock 结尾断言（用 process.platform 分支写断言）。
// 4. resolveSessionName(undefined) 先设 process.env.BROWSERCLI_SESSION='envx' 得 'envx'，finally 删除后得 'default'。
// 5. saveSessionFile → loadSessionFile 往返一致；loadSessionFile 不存在的名字返回 undefined；
//    listSessionFiles 忽略非 .session 文件（目录里放一个 1.err）。
```

实现这些断言的具体代码按上述注释展开，每个用例一个 `test()`，AAA 结构。

- [ ] **Step 2: 运行确认失败**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/registry.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/ipc/registry.ts`（语义对照 `open-source/playwright/packages/playwright-core/src/tools/cli-client/registry.ts`，差异：无 `--persistent` 概念、workspace 找不到时不退回 hash-only 而是回退 cwd）：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 会话注册表。与 browsercli/src/sessionPaths.ts 配对，
 * 两侧的路径算法（base dir / workspace 探测 / hash / 管道名）必须保持同步。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pipePath, PROTOCOL_VERSION } from './socketConnection.js';

export interface SessionConfig {
  name: string;
  version: string;
  protocol: number;
  timestamp: number;
  socketPath: string;
  pid: number;
  workspaceDir?: string;
  consolePort?: number;
}

export interface SessionFile {
  file: string;
  daemonDir: string;
  config: SessionConfig;
}

export interface ClientInfo {
  version: string;
  workspaceDir: string;
  workspaceDirHash: string;
  daemonDir: string;
}

export function computeWorkspaceDir(startDir: string): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.browsercli'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

function computeBaseDaemonDir(): string {
  if (process.env.BROWSERCLI_DAEMON_DIR) return process.env.BROWSERCLI_DAEMON_DIR;
  let cache: string;
  if (process.platform === 'linux')
    cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cache = path.join(os.homedir(), 'Library', 'Caches');
  else cache = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(cache, 'browsercli', 'daemon');
}

export function computeClientInfo(startDir?: string, version = '0.0.0'): ClientInfo {
  const workspaceDir = computeWorkspaceDir(startDir ?? process.cwd());
  const workspaceDirHash = crypto
    .createHash('sha1')
    .update(workspaceDir)
    .digest('hex')
    .slice(0, 16);
  return {
    version,
    workspaceDir,
    workspaceDirHash,
    daemonDir: path.join(computeBaseDaemonDir(), workspaceDirHash),
  };
}

export function makePipePath(dirHash: string, sessionName: string): string {
  if (process.platform === 'win32')
    return pipePath(`browsercli-${dirHash}-${sessionName}`);
  return path.join(os.tmpdir(), `browsercli-${dirHash}-${sessionName}.sock`);
}

export function explicitSessionName(name?: string): string | undefined {
  return name || process.env.BROWSERCLI_SESSION;
}

export function resolveSessionName(name?: string): string {
  return explicitSessionName(name) ?? 'default';
}

export async function saveSessionFile(info: ClientInfo, config: SessionConfig): Promise<SessionFile> {
  await fs.promises.mkdir(info.daemonDir, { recursive: true });
  const file = path.join(info.daemonDir, `${config.name}.session`);
  await fs.promises.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  return { file, daemonDir: info.daemonDir, config };
}

export async function loadSessionFile(info: ClientInfo, name: string): Promise<SessionFile | undefined> {
  try {
    const file = path.join(info.daemonDir, `${name}.session`);
    const data = await fs.promises.readFile(file, 'utf-8');
    return { file, daemonDir: info.daemonDir, config: JSON.parse(data) as SessionConfig };
  } catch {
    return undefined;
  }
}

export async function listSessionFiles(info: ClientInfo): Promise<SessionFile[]> {
  const names = await fs.promises.readdir(info.daemonDir).catch(() => []);
  const result: SessionFile[] = [];
  for (const n of names.filter(f => f.endsWith('.session'))) {
    const loaded = await loadSessionFile(info, path.basename(n, '.session'));
    if (loaded) result.push(loaded);
  }
  return result;
}

export async function deleteSessionFile(sf: SessionFile): Promise<void> {
  await fs.promises.rm(sf.file, { force: true }).catch(() => undefined);
}

export { PROTOCOL_VERSION };
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/registry.test.js`
Expected: PASS 全部

- [ ] **Step 5: 格式 + 提交**

```bash
npx prettier --write src/ipc/registry.ts tests/unit/ipc/registry.test.ts
npm run typecheck
git add src/ipc/registry.ts tests/unit/ipc/registry.test.ts
git commit -m "feat(ipc): add session registry with workspace-scoped pipe paths"
```

---

### Task 3: 下线 Sekiro 与 /api/v1，抽出 browserRequests

**Files:**
- Delete: `src/worker/SekiroInvoker.ts`、`src/types/rpc.ts`、`src/web/routes/apiV1.ts`、`src/web/middleware/bearerAuth.ts`、`tests/unit/web/routes/apiV1.test.ts`、`tests/unit/web/routes/apiV1.browser.test.ts`、`tests/unit/web/bearerAuth.test.ts`、`tests/integration/workerHttp.test.ts`、`tests/unit/worker/SekiroInvoker.test.ts`（若存在）
- Create: `src/worker/browserRequests.ts`、`tests/unit/worker/browserRequests.test.ts`
- Modify: `src/index.ts`、`src/web/ConsoleServer.ts`、`src/worker/ToolAdapter.ts`、`src/worker/WorkerArgs.ts`、`src/config/constants.ts`、`src/config/resolver.ts`、`src/config/schema.ts`、`src/types/platform.ts`、`src/web/types.ts`、`src/web/routes/worker.ts`、`src/web-ui/src/lib/protocol.ts`、`src/web-ui/src/routes/overview.tsx`、`src/modules/collector/CodeCache.ts:373`（注释）、`src/modules/browser/cloak.ts:44`（注释）、`tests/unit/web/ConsoleServer.test.ts`、`tests/unit/worker/ToolAdapter.test.ts`

**Interfaces:**
- Produces: `parseBrowserConnectBody(body: unknown): BrowserConfig`、`parseBrowserDisconnectBody(body: Record<string, unknown>): boolean`、`effectiveBrowserConfig(): BrowserManagerConfig`、`BrowserConfigRequestError`（全部从 apiV1.ts 原样迁移到 `src/worker/browserRequests.ts`，行为不变）；Task 4 直接 import。

- [ ] **Step 1: 先迁移，再删除（保持测试绿）**

把 `src/web/routes/apiV1.ts` 中 `BrowserConnectSchema`、`BrowserConfigRequestError`、`hasOwn`、`requireProtocol`、`parseBrowserConnectBody`、`parseBrowserDisconnectBody`、`effectiveBrowserConfig` 整段移到新文件 `src/worker/browserRequests.ts` 并导出。把 apiV1 两个测试文件里针对这些函数的用例（`apiV1.browser.test.ts` 的主体）搬到 `tests/unit/worker/browserRequests.test.ts`（改 import 路径即可）。

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/worker/browserRequests.test.js`
Expected: PASS

- [ ] **Step 2: 删除 HTTP 远程路径**

1. 删除上方文件清单里的 Delete 项。
2. `ConsoleServer.ts`：删 `invoker` 选项与 import、`bearerAuth` import 及 `/api/v1` 分支（所有请求走 `rejectIfNotLocal`）、`createApiV1Routes` import 与 mount、`defaultJobStore` 兜底（JobStore 由 T4/T5 传入持有）；`options.jobStore` 保留为可选。
3. `src/index.ts`：删 `SekiroInvoker` import 与实例化，`ConsoleServer` 构造参数去掉 `invoker`、`group`、`rpcHost`（ConsoleServer 的 `group/rpcHost` 选项随 worker 路由一并处理，见下）；`workerStartContext` 整个删掉。
4. `ToolAdapter.ts`：删 `wrapTool` 方法与 `ActionHandler` import（`ToolExecutionPipeline.test`/`ToolAdapter.test` 中 wrapTool 用例删除）。
5. `WorkerArgs.ts`：`VALUE_FLAGS` 删 `--group/--rpcHost`；`toWorkerOptions` 返回体删对应字段；`src/types/platform.ts::WorkerStartOptions` 删 `rpcHost/group`。
6. `src/config/constants.ts` 删 `DEFAULT_GROUP/DEFAULT_RPC_HOST`；`resolver.ts` 删 `rpcHost` 字段（第 67/90/106/310 行附近）、`schema.ts:141` 删 `rpcHost`。
7. `web/types.ts::WorkerStatus` 删 `rpcHost/group`；`web/routes/worker.ts::WorkerRoutesConfig` 删 `group/rpcHost`，`buildWorkerStatus` 输出 `{ok, version, uptime, pid}`；`web-ui/src/lib/protocol.ts:53` 删 `rpcHost?` 与 `group`（若有）、`overview.tsx:263-265` 删该展示行。
8. 注释更新：`CodeCache.ts:373` 改为「避免长阻塞饿死 socket 心跳」类措辞、`cloak.ts:44` 改为「daemon 的 stdout 是就绪握手通道 —— 任何非协议字节会破坏 CLI 的启动检测」。
9. `tests/unit/web/ConsoleServer.test.ts` 删除 invoker/apiV1 相关 mock 与断言。

- [ ] **Step 3: 全量单测验证**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/**/*.test.js`
Expected: PASS（`grep -rn "apiV1\|Sekiro\|bearerAuth" src tests` 无功能性残留）

Run: `npm run typecheck`
Expected: 0 错误

- [ ] **Step 4: web-ui typecheck + 提交**

```bash
npm run web:typecheck
npx prettier --write src/ tests/
git add -A src tests
git commit -m "refactor(web)!: remove Sekiro RPC and /api/v1 HTTP transport"
```

---

### Task 4: daemon 端 socket 服务 `src/ipc/daemonServer.ts`

**Files:**
- Create: `src/ipc/daemonServer.ts`
- Test: `tests/unit/ipc/daemonServer.test.ts`

**Interfaces:**
- Consumes: Task 1 `SocketConnection`；Task 2 `SessionConfig`；`ToolAdapter.executeTool(meta, params, sessionId?, signal?)`、`JobStore`、`WsHub.subscribe/handleDisconnect/broadcast`、`workerActivityCoordinator.getState()`、Task 3 `browserRequests`、`BrowserConnectionManager.{connectBrowser,disconnectBrowser,getBrowserConnectionStatus}`
- Produces:

```ts
export interface DaemonDeps {
  sessionName: string;
  version: string;
  startedAt: number;
  runtime: { contextProvider: ToolContextProvider; browserManager: unknown };
  contextProvider: ToolContextProvider;
  toolAdapter: ToolAdapter;
  jobStore: JobStore;
  wsHub: WsHub;
  listToolsMeta: () => ToolMeta[];
  getToolMeta: (name: string) => ToolMeta | undefined;
  onStop: () => Promise<void>; // stop 方法：删 session 文件 + 关管道 + 由调用方退出进程
}
export interface DaemonHandle { socketPath: string; close: () => Promise<void> }
export async function startDaemonServer(deps: DaemonDeps, socketPath: string): Promise<DaemonHandle>
```

方法语义（响应 `error.code`）：`hello` → `{version, protocol: PROTOCOL_VERSION, pid, session}`；`tools.list` → `{tools}`；`tool.invoke {tool, params}` → 忙则 `{code:'WORKER_BUSY'}`（409 语义），否则建 JobStore job、`executeTool(..., sessionName, controller.signal)`、返回 job.result；运行中客户端断线 ⇒ `controller.abort()` + `jobStore.cancel(...)`；`browser.status` → `getBrowserConnectionStatus(...)`；`browser.connect`（body 即原 POST /api/v1/browser/connect 的 JSON）→ 先 `rejectIfBusy('browser')` 再 `RuntimeConfigStore.update({browser: patch})` + `connectBrowser`，成功回 status 并 `wsHub.broadcast('worker.status', {browser: status})`；`browser.disconnect {force?}` 同 apiV1 逻辑（含活动中止）；`jobs.list`/`jobs.cancel {jobId}` 同 apiV1 cancel 语义（controller.abort + 1s 等待 + force）；`subscribe {channels: string[]}` → 为该连接建 `SocketWsAdapter` 并逐个 `wsHub.subscribe(adapter, ch)`，回 `{subscribed: channels}`；`stop` → 先回 `{result:'ok'}` 再 `deps.onStop()`。

- [ ] **Step 1: 写失败测试**

`tests/unit/ipc/daemonServer.test.ts`：用桩 deps（`toolAdapter.executeTool` 返回 `params.echo`、可注入延迟；`wsHub` 用真实 `WsHub`；`jobStore` 真实 `JobStore`；`contextProvider/browserManager` 用最小 fake），`startDaemonServer(deps, makePipePath(<random>,'t'))`，`net.connect` + `SocketConnection` 验证：

```ts
// 1. hello 返回 version/protocol/pid/session 且 protocol===PROTOCOL_VERSION
// 2. tools.list 透传桩 listToolsMeta 结果
// 3. tool.invoke 正常路径：result 等于 echo；jobStore 出现 done job
// 4. tool.invoke 忙路径：第一次 invoke 挂起（deferred），第二次 invoke 收到 error.code==='WORKER_BUSY'
// 5. 断线中止：挂起 job 期间 client.close()，deferred reject 后 jobStore 终态为 'cancelled'
// 6. subscribe：订阅后 deps.wsHub.broadcast('log', {m:1})，客户端收到 {type:'event',channel:'log',payload:{m:1}}
// 7. stop：收到 result 'ok'，onStop 被调用一次
```

测试内部 `afterEach` 关闭 handle 与 socket；`before` 里 `process.env.BROWSERCLI_DAEMON_DIR` 指向 tmp（仅 registry 用例需要，本任务用 `makePipePath` 生成随机名即可）。

- [ ] **Step 2: 运行确认失败**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/daemonServer.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/ipc/daemonServer.ts` 核心骨架（方法分发按上面语义逐条实现；`runJobOnce` 逻辑从被删的 apiV1 `runJob` 迁移，`JobAbortError`/超时逻辑保留 `JOB_TIMEOUT` 但默认超时改为客户端负责——daemon 侧不再挂 timer，signal 仅来自断线/取消）：

```ts
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getRuntimeConfigStore } from '../config/RuntimeConfigStore.js';
import type { ToolMeta } from '../tools/tools-meta.js';
import {
  connectBrowser,
  disconnectBrowser,
  getBrowserConnectionStatus,
} from '../worker/BrowserConnectionManager.js';
import type { JobStore } from '../worker/JobStore.js';
import {
  BrowserConfigRequestError,
  effectiveBrowserConfig,
  parseBrowserConnectBody,
  parseBrowserDisconnectBody,
} from '../worker/browserRequests.js';
import { WorkerBusyError, workerActivityCoordinator } from '../worker/WorkerActivityCoordinator.js';
import type { WsHub, MinimalWebSocket } from '../web/ws/WsHub.js';
import type { ToolAdapter } from '../worker/ToolAdapter.js';
import type { ToolContextProvider } from '../worker/ToolContext.js';
import { PROTOCOL_VERSION, SocketConnection } from './socketConnection.js';
import type { DaemonDeps } from './daemonServer-types.js'; // 或直接本文件内定义并导出

class SocketWsAdapter implements MinimalWebSocket {
  readyState = 1;
  constructor(private readonly conn: SocketConnection) {}
  send(data: string): void {
    void this.conn.send(JSON.parse(data)).catch(() => undefined);
  }
}

class ActiveJob {
  readonly controller = new AbortController();
  constructor(readonly jobId: string, readonly execution: Promise<void>) {}
}

export async function startDaemonServer(deps: DaemonDeps, socketPath: string): Promise<{ socketPath: string; close: () => Promise<void> }> {
  if (process.platform !== 'win32') {
    await fs.promises.unlink(socketPath).catch(() => undefined);
  }
  let activeJob: ActiveJob | undefined;
  const adapters = new Map<SocketConnection, SocketWsAdapter>();

  const server = net.createServer(raw => {
    const conn = new SocketConnection(raw);
    const adapter = new SocketWsAdapter(conn);
    adapters.set(conn, adapter);
    conn.onclose = () => {
      deps.wsHub.handleDisconnect(adapter);
      adapters.delete(conn);
      if (activeJob) {
        const job = activeJob;
        job.controller.abort({ code: 'JOB_CANCELLED', message: 'client disconnected' } as never);
      }
    };
    conn.onmessage = async message => {
      const { id, method, params } = message as { id: number; method: string; params?: Record<string, unknown> };
      try {
        const result = await dispatch(method, params ?? {});
        await conn.send({ id, result });
      } catch (e) {
        const err = e as { code?: string; message?: string };
        await conn.send({ id, error: { code: err.code ?? 'INTERNAL', message: err.message ?? String(e) } }).catch(() => undefined);
      }
    };
  });

  async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'hello':
        return { version: deps.version, protocol: PROTOCOL_VERSION, pid: process.pid, session: deps.sessionName, uptimeMs: Date.now() - deps.startedAt };
      case 'tools.list':
        return { tools: deps.listToolsMeta() };
      case 'tool.invoke': {
        const tool = String(params.tool ?? '');
        const meta = deps.getToolMeta(tool);
        if (!meta) throw Object.assign(new Error(`tool not found: ${tool}`), { code: 'TOOL_NOT_FOUND' });
        const activity = workerActivityCoordinator.getState();
        if (activeJob || activity.browserOperation || activity.activeTools > 0)
          throw Object.assign(new Error('worker is busy'), { code: 'WORKER_BUSY', state: activity });
        const job = deps.jobStore.create(deps.sessionName, tool, (params.params as Record<string, unknown>) ?? {});
        const controller = new AbortController();
        const execution = (async () => {
          deps.jobStore.markRunning(job.jobId);
          try {
            const result = await deps.toolAdapter.executeTool(meta, (params.params as Record<string, unknown>) ?? {}, deps.sessionName, controller.signal);
            deps.jobStore.complete(job.jobId, result);
          } catch (e) {
            const err = e as { code?: string; message?: string; retryable?: boolean; recovery?: unknown; details?: unknown };
            const wrapped = { code: err.code ?? 'RUNTIME', message: err.message ?? String(e), ...(err.retryable !== undefined ? { retryable: err.retryable } : {}), ...(err.recovery !== undefined ? { recovery: err.recovery } : {}), ...(err.details !== undefined ? { details: err.details } : {}) };
            if (err.code === 'JOB_CANCELLED') deps.jobStore.cancel(job.jobId, wrapped as never);
            else deps.jobStore.fail(job.jobId, wrapped as never);
            throw e;
          } finally {
            if (activeJob?.jobId === job.jobId) activeJob = undefined;
          }
        })();
        activeJob = new ActiveJob(job.jobId, execution);
        void execution.catch(() => undefined);
        await execution;
        return deps.jobStore.get(job.jobId).result;
      }
      case 'browser.status':
        return getBrowserConnectionStatus(deps.contextProvider, effectiveBrowserConfig());
      case 'browser.connect': {
        // 忙判定与 apiV1 一致：browser 操作要求无活动 job/tools
        const activity = workerActivityCoordinator.getState();
        if (activeJob || activity.browserOperation || activity.activeTools > 0)
          throw Object.assign(new Error('worker is busy'), { code: 'WORKER_BUSY', state: activity });
        const patch = parseBrowserConnectBody(params.body ?? {});
        getRuntimeConfigStore().update({ browser: patch });
        const config = effectiveBrowserConfig();
        await connectBrowser(deps.contextProvider, config);
        const status = getBrowserConnectionStatus(deps.contextProvider, config);
        deps.wsHub.broadcast('worker.status', { browser: status });
        return status;
      }
      case 'browser.disconnect': {
        const force = parseBrowserDisconnectBody((params.body as Record<string, unknown>) ?? {});
        // …与 apiV1 相同的活动中止 + disconnectBrowser + broadcast，直接照抄原实现体
        await abortActiveJob(force, 'job cancelled by browser disconnect');
        if (!force && (await busyAfterAbort())) throw Object.assign(new Error('worker is busy'), { code: 'WORKER_BUSY' });
        await disconnectBrowser(deps.contextProvider, { force });
        const status = getBrowserConnectionStatus(deps.contextProvider, effectiveBrowserConfig());
        deps.wsHub.broadcast('worker.status', { browser: status });
        return status;
      }
      case 'jobs.list':
        return { jobs: deps.jobStore.list() };
      case 'jobs.cancel': {
        const jobId = String(params.jobId ?? '');
        const job = deps.jobStore.get(jobId); // 不存在时 JobStore 抛错 → INTERNAL，测试 4/5 不覆盖此码
        if (!['pending', 'running'].includes(job.status)) return job;
        if (!activeJob || activeJob.jobId !== jobId)
          throw Object.assign(new Error(`job is not active: ${jobId}`), { code: 'JOB_NOT_CANCELLABLE' });
        // …与 apiV1 相同：abort → race execution/1s → 必要时 finalize cancel
        return deps.jobStore.get(jobId);
      }
      case 'subscribe': {
        const channels = (params.channels as string[]) ?? [];
        const adapter = currentAdapter(conn); // 见正文：conn 经闭包传入 dispatch 或把 adapter 挂在 params 上
        for (const ch of channels) deps.wsHub.subscribe(adapter, ch as never);
        return { subscribed: channels };
      }
      case 'stop':
        queueMicrotask(() => void deps.onStop().catch(() => undefined));
        return 'ok';
      default:
        throw Object.assign(new Error(`unknown method: ${method}`), { code: 'UNKNOWN_METHOD' });
    }
  }
  // 正文说明：dispatch 需要访问当前连接的 adapter，将签名改为
  // dispatch(conn, method, params) 并在 createServer 里传 conn。

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  return {
    socketPath,
    close: async () => {
      for (const a of adapters.values()) a.readyState = 0;
      await new Promise<void>(r => server.close(() => r()));
      if (process.platform !== 'win32') await fs.promises.unlink(socketPath).catch(() => undefined);
    },
  };
}
```

实现时注意：`subscribe`/`onclose` 共享 adapter ⇒ `dispatch(conn, ...)` 显式传连接；`abortActiveJob`/`busyAfterAbort` 是从 apiV1 `POST disconnect`/`jobs cancel` 抽出的一对内部函数；`ToolMeta`、类型导入按项目 lint 规则放置。上面 `// …与 apiV1 相同` 的三处，其原始代码就在被删的 `src/web/routes/apiV1.ts`（git 历史 `HEAD~1` 可见），逐行移植语义即可（busy message 改 code 抛错）。

- [ ] **Step 4: 运行确认通过**

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/daemonServer.test.js`
Expected: PASS ×7

- [ ] **Step 5: 格式 + 提交**

```bash
npx prettier --write src/ipc/daemonServer.ts tests/unit/ipc/daemonServer.test.ts
npm run typecheck && npm run check-format
git add src/ipc tests/unit/ipc
git commit -m "feat(ipc): add daemon socket server exposing tools/browser/jobs"
```

---

### Task 5: `src/index.ts` daemon 模式与就绪握手

**Files:**
- Modify: `src/index.ts`、`src/worker/WorkerArgs.ts`、`src/web/ConsoleServer.ts`
- Test: `tests/unit/worker/WorkerArgs.test.ts`（更新）、`tests/unit/ipc/daemonMode.test.ts`（新建，纯函数部分）

**Interfaces:**
- Consumes: Task 1-4 全部
- Produces: worker 入口支持 `--daemon --session <name>`（win：命名管道 / POSIX：unix socket）；就绪行 `Daemon listening on <socketPath>`；`src/worker/daemonMain.ts` 导出 `runDaemon(opts): Promise<DaemonHandle & {stop: () => Promise<void>}>` 供集成测试直接调用。

- [ ] **Step 1: 失败测试**

`tests/unit/ipc/daemonMode.test.ts` 测 `buildDaemonArgPlan`（见 Step 3 的导出纯函数）：

```ts
// 1. buildDaemonArgPlan(['--daemon','--session','proj-a','--no-console','--browsercli-daemon'])
//    → { daemon:true, session:'proj-a', noConsole:true }
// 2. session 缺省 → 'default'；env BROWSERCLI_SESSION='e1' 时 → 'e1'
// 3. 非 --daemon 数组 → { daemon:false }
```

Run: `npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/daemonMode.test.js`
Expected: FAIL

- [ ] **Step 2: 实现入口分支**

`src/worker/WorkerArgs.ts`：`BOOLEAN_FLAGS` 加 `'--daemon': 'daemon'`? —— 不污染 GlobalConfig：daemon 参数**不走** parseWorkerArgs，单独放新文件 `src/ipc/daemonArgs.ts` 导出 `buildDaemonArgPlan(argv: string[]): { daemon: boolean; session: string; noConsole: boolean; consolePort?: number }`（`--session` 取下一 token 或 `--session=x`；`--console-port` 同理；`--browsercli-daemon`、`--no-console` 布尔识别）。

`src/index.ts` 顶部：

```ts
import { buildDaemonArgPlan } from './ipc/daemonArgs.js';
import { runDaemon } from './worker/daemonMain.js';

const daemonPlan = buildDaemonArgPlan(process.argv.slice(2));
if (daemonPlan.daemon) {
  runDaemon(daemonPlan).catch(err => { console.error('[Daemon] 启动失败:', err); process.exit(1); });
} else {
  void main();
}
```

`src/worker/daemonMain.ts`：复用 `main()` 的步骤 1-5（config 播种、runtime/contextProvider 初始化、自动连接缓存目标），随后：

```ts
export async function runDaemon(plan: DaemonPlan) {
  const version = (await import('../../package.json', { with: { type: 'json' } })).default.version ?? '0.0.0';
  const info = computeClientInfo(process.cwd(), version);
  const socketPath = makePipePath(info.workspaceDirHash, plan.session);
  const jobStore = new JobStore();
  const wsHub = new WsHub();
  let consoleServer: ConsoleServer | undefined;
  let consolePort: number | undefined;
  if (!plan.noConsole) {
    // ConsoleServer 新签名：{ wsHub, host:'127.0.0.1', port: plan.session==='default' ? 8765 : (plan.consolePort ?? 0), ... }
    consoleServer = new ConsoleServer({ port: ..., host: '127.0.0.1', runtime, wsHub, toolAdapter, jobStore, configSeed });
    await consoleServer.start();
    consolePort = consoleServer.getActualPort();
  }
  const gracefulShutdown = createGracefulShutdown({ browserManager: runtime.browserManager, contextProvider });
  let handle!: { socketPath: string; close(): Promise<void> };
  const stop = async () => {
    await deleteSessionFile(sessionFile).catch(() => undefined);
    await handle.close().catch(() => undefined);
    await consoleServer?.stop().catch(() => undefined);
  };
  handle = await startDaemonServer(deps, socketPath);
  const sessionFile = await saveSessionFile(info, { name: plan.session, version, protocol: PROTOCOL_VERSION, timestamp: Date.now(), socketPath, pid: process.pid, workspaceDir: info.workspaceDir, consolePort });
  // 就绪握手：stdout 精确一行，CLI 以此判定 daemon 可用
  console.log(`Daemon listening on ${socketPath}`);
  process.on('SIGINT', () => void stop().then(() => gracefulShutdown('SIGINT')));
  process.on('SIGTERM', () => void stop().then(() => gracefulShutdown('SIGTERM')));
  return { handle, stop };
}
```

注意启动顺序：`startDaemonServer` 成功后才写 session 文件（防止 session 文件指向未监听管道）；`onStop` 注入 `stop()` + `gracefulShutdown`。

- [ ] **Step 3: ConsoleServer 改造**

`ConsoleServerOptions`：删 `group/rpcHost/invoker`，加 `wsHub: WsHub`（构造里 `this.wsHub = options.wsHub`，不再 new）；`start()` 里 listen 完成后记录 `this.actualPort = (this.httpServer.address() as net.AddressInfo).port`；新增 `getActualPort(): number`。`workerStartContext` 及 `src/index.ts` 对它的赋值全部删除。

- [ ] **Step 4: 验证**

```bash
npm run build:dev && node --no-warnings=ExperimentalWarning --test build/tests/unit/ipc/daemonMode.test.js build/tests/unit/web/ConsoleServer.test.js
npm run typecheck
git add src/index.ts src/ipc/daemonArgs.ts src/worker/daemonMain.ts src/worker/WorkerArgs.ts src/web/ConsoleServer.ts tests
git commit -m "feat(ipc): add detached daemon mode entry with pipe readiness handshake"
```

手动烟测（本 Task 内完成）：

```powershell
$env:BROWSERCLI_DAEMON_DIR="$env:TEMP\bcli-test"
node build/src/index.js --daemon --browsercli-daemon --session smoke --no-console
# 预期 stdout: Daemon listening on \\.\pipe\browsercli-<hash>-smoke；Ctrl+C 后 <hash>\smoke.session 文件消失
```

---

### Task 6: browsercli 客户端 `daemonClient.ts` + `sessionPaths.ts`

**Files:**
- Create: `browsercli/src/sessionPaths.ts`、`browsercli/src/daemonClient.ts`
- Test: `browsercli/tests/unit/sessionPaths.test.ts`、`browsercli/tests/unit/daemonClient.test.ts`

**Interfaces:**
- Consumes: 仅 stdlib（`net`/`node:crypto`/`node:child_process`/`node:fs`）；协议常量 `PROTOCOL_VERSION = 1`（本侧复制，注释互指 `src/ipc/socketConnection.ts`）
- Produces:

```ts
// sessionPaths.ts —— 与 src/ipc/registry.ts 同步的路径计算
export interface SessionConfig { /* 同 worker 侧字段 */ }
export function computeWorkspaceDir(startDir: string): string
export function computeClientInfo(startDir?: string): { workspaceDir; workspaceDirHash; daemonDir }
export function makePipePath(dirHash: string, session: string): string
export function resolveSessionName(name?: string): string
export function explicitSessionName(name?: string): string | undefined
export async function loadSession(daemonDir: string, name: string): Promise<SessionConfig | undefined>
export async function listSessions(daemonDir: string): Promise<SessionConfig[]>
export async function deleteSession(daemonDir: string, name: string): Promise<void>

// daemonClient.ts
export class DaemonConnection {
  static async connect(socketPath: string, timeoutMs?: number): Promise<DaemonConnection>
  request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>
  onEvent(cb: (msg: {type?: string; channel?: string; payload?: unknown}) => void): () => void
  close(): void
}
export interface EnsureDaemonOptions { session: string; spawnFlags: string[]; cwd?: string }
export async function ensureDaemon(opts: EnsureDaemonOptions): Promise<SessionConfig>
export async function spawnDaemon(opts: EnsureDaemonOptions): Promise<SessionConfig>
export async function stopSession(cfg: SessionConfig): Promise<void>
export async function killAllDaemons(): Promise<number[]>
export function resolveEntryPath(): string   // env BROWSERCLI_ENTRY > config workerEntry > 错误(带恢复提示)
export const DEFAULT_INVOKE_TIMEOUT_MS = 300_000
```

- [ ] **Step 1: 失败测试 — sessionPaths**

`browsercli/tests/unit/sessionPaths.test.ts`：复制 worker 侧 Task 2 的 5 个关键用例（workspace 探测、hash 稳定性、pipePath 形态、env session 解析、load/list/delete 往返），import 路径改为 `../../src/sessionPaths.js`。

- [ ] **Step 2: 失败测试 — daemonClient 核心逻辑**

`browsercli/tests/unit/daemonClient.test.ts`：

```ts
// 用真实 net server 当假 daemon（手写 SocketConnection 帧或裸 write JSON 行）：
// 1. connect 成功 + request('hello') 解析 {result}
// 2. 请求 error 响应 → request 抛 Error，message 含 code
// 3. 超时：server 不回包，request(…, 200) 以 'timeout' 类错误 reject
// 4. onEvent：server 主动 write 一行 {type:'event',...} → 回调收到；off 后不再收
// 5. resolveEntryPath：设 BROWSERCLI_ENTRY 指向任意存在文件 → 返回它；
//    未设且配置文件无 workerEntry → 抛错且 suggestions 含 "browsercli config --set workerEntry="
// 6. spawnDaemon：entry 用 `node -e` 内联脚本 —— 打印 'Daemon listening on fake' 后挂起；
//    断言 resolve 的 session 文件已写入（测试注入 daemonDir 参数版本 spawnDaemon，
//    故签名多一个 opts.daemonDir?: string 供测试隔离 BROWSERCLI_DAEMON_DIR）
// 7. killAllDaemons 纯测模式匹配函数 collectDaemonPids(lines: string[]): number[]（导出，
//    喂 fake `ps auxww`/PowerShell 输出断言只命中含 '--browsercli-daemon' 的行）
```

Run: `npm --prefix browsercli test`
Expected: FAIL（模块不存在；既有用例保持 PASS）

- [ ] **Step 3: 实现**

`sessionPaths.ts`：Task 2 实现的小幅移植（无 save，`loadSession/listSessions/deleteSession` 用 fs/promises）。
`daemonClient.ts`：内联约 40 行 NDJSON 帧类（与 worker 侧 `SocketConnection` 等价，注释互指；两包零耦合，这是唯一有意重复的 40 行）；`request` 用 `Map<id, {resolve,reject}>` + `AbortSignal.timeout`；`spawnDaemon`：

```ts
export async function spawnDaemon(opts: EnsureDaemonOptions & { daemonDir?: string }): Promise<SessionConfig> {
  const entry = resolveEntryPath();
  const cwd = opts.cwd ?? process.cwd();
  const info = computeClientInfo(cwd);
  const daemonDir = opts.daemonDir ?? info.daemonDir;
  await fs.promises.mkdir(daemonDir, { recursive: true });
  const errLog = path.join(daemonDir, `${opts.session}.err`);
  const err = fs.openSync(errLog, 'w');
  const child = spawn(process.execPath, [entry, '--daemon', '--browsercli-daemon', '--session', opts.session, ...opts.spawnFlags],
    { detached: true, stdio: ['ignore', 'pipe', err], cwd, windowsHide: true });
  let outLog = '';
  const ready = await new Promise<'ok' | 'exit'>((resolveP) => {
    const timer = setTimeout(() => resolveP('exit'), 30_000);
    child.stdout!.on('data', d => {
      outLog += d.toString();
      if (outLog.includes('Daemon listening on')) { clearTimeout(timer); resolveP('ok'); }
    });
    child.once('close', () => { clearTimeout(timer); resolveP('exit'); });
  });
  child.stdout!.destroy();
  child.unref();
  fs.closeSync(err);
  if (ready !== 'ok') {
    const errText = fs.existsSync(errLog) ? fs.readFileSync(errLog, 'utf-8') : '';
    throw new Error(`daemon 启动失败 (pid=${child.pid}):${outLog ? '\n' + outLog : ''}${errText ? '\n' + errText : ''}`);
  }
  const cfg = await loadSession(daemonDir, opts.session);
  if (!cfg) throw new Error('daemon 就绪但 session 文件缺失');
  if (cfg.protocol !== PROTOCOL_VERSION)
    throw new Error(`协议不匹配: daemon v${cfg.protocol} vs cli v${PROTOCOL_VERSION}，运行 browsercli -s=${opts.session} close 后重新 open`);
  return cfg;
}
```

`ensureDaemon` = `loadSession` → 无则 `spawnDaemon`；有则 `DaemonConnection.connect(cfg.socketPath, 3000)`，失败（陈旧注册）→ `deleteSession` + `spawnDaemon`。
`stopSession` = `request('stop', {}, 5000)`（吞掉 ECONNREFUSED/EOF = 已死）→ 兜底 `process.kill(cfg.pid, 0)` 探不到即清理 session 文件。
`killAllDaemons`：win32 用 `execSync('powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*--browsercli-daemon*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }"')`，POSIX 用 `ps auxww` 行过滤 + `process.kill(pid,'SIGKILL')`；纯函数 `collectDaemonPids(lines)` 供测试。

Run: `npm --prefix browsercli test` → 新用例 PASS，旧用例（仍引用 WorkerHttpClient 的）暂不动。

- [ ] **Step 4: 提交**

```bash
git add browsercli/src/sessionPaths.ts browsercli/src/daemonClient.ts browsercli/tests/unit/sessionPaths.test.ts browsercli/tests/unit/daemonClient.test.ts
git commit -m "feat(cli): add daemon socket client, session registry and spawn logic"
```

---

### Task 7: browsercli 命令全量切换 + 会话命令

**Files:**
- Modify: `browsercli/src/types.ts`、`app.ts`、`bin/browsercli.ts`、`help.ts`、`commands/tool-dispatcher.ts`、`commands/browser.ts`、`commands/jobs.ts`、`commands/status.ts`、`commands/list-tools.ts`、`commands/config.ts`
- Create: `browsercli/src/commands/sessions.ts`（open/close/list/kill-all）
- Delete: `browsercli/src/WorkerHttpClient.ts`、`browsercli/tests/unit/WorkerHttpClient.test.ts`、`browsercli/tests/unit/WorkerHttpClient.browser.test.ts`、`browsercli/index.ts` 中相关导出
- Test: 更新 `browsercli/tests/unit/{tool-dispatcher,browser,jobs,status}.test.ts`；新建 `browsercli/tests/unit/sessions.test.ts`

**Interfaces:**
- Consumes: Task 6 全部导出
- Produces:

```ts
// types.ts
export interface WorkerContext {
  session: string;                                  // resolveSessionName(argv -s/--session/env)
  daemonDir?: string;                               // 测试注入
  connect: () => Promise<DaemonConnection>;         // 懒执行 ensureDaemon+connect
}
```

- [ ] **Step 1: 逐个命令改造（每步后 `npm --prefix browsercli test`）**

1. **types/app**：`WorkerContext` 换上面形状；`createWorkerContext()` 自己扫 `process.argv` 找 `-s=x`/`--session x`（args-parser 的 `parseArgs` 对全 argv 跑一遍取 `session`/`s`），`connect` 闭包 = `ensureDaemon({session, spawnFlags: browserSpawnFlagsFromArgv(argv)}) → DaemonConnection.connect(socketPath)`；`spawnFlags` 透传 `--no-console`、`--console-port`、`--cloak`、`--headless` 等 worker flag（白名单数组：`['--no-console','--cloak','--js-stealth','--full-stealth-args','--minimal-stealth','--headless']`，另支持 `--console-port` 取值）。删 `transport`/`WORKER_URL`/`WORKER_API_TOKEN` 语义。
2. **list-tools**：`await ctx.connect().then(c => c.request('tools.list'))` → `{tools}`；错误映射 `WORKER_NOT_RUNNING`（connect 失败）保持现有报错形状。删 cachedSessionId 概念。
3. **call（tool-dispatcher）**：`candidate.name` 解析与消歧逻辑**不动**；执行改 `client.request('tool.invoke', {tool, params}, timeout)`，`WORKER_BUSY` 捕获后按 `[200,500,1000]` 退避重发（同旧 submit 重试语义）；`--watch`：invoke 前 `client.request('subscribe',{channels:['tool.invoke','hook.event','hook.sample','log']})` + `client.onEvent(ev => console.log('[stream]', JSON.stringify(ev)))`，invoke 完成后 `close()`；`extractToolFailure`/`--json`/位置参数逻辑不变。
4. **browser**：`connectBrowser/disconnectBrowser/getBrowserStatus` → `request('browser.connect',{body:opts})`/`('browser.disconnect',{body:{force}})`/`('browser.status')`；CLI 侧全部参数校验保留；`ensureDaemon` 的 spawnFlags 在 action==='connect' 时不传特殊 flag（默认 daemon 未连浏览器，connect 由请求携带 body）。
5. **jobs**：`request('jobs.list')`/`request('jobs.cancel',{jobId})`；渲染逻辑不动。
6. **status**：改为读注册表聚合：`listSessions(daemonDir)` → 对每个 socket `connect(500ms)`+`request('hello',{},1000)`，成功计 open、失败 GC `deleteSession` 并计 closed-stale；表格列 `Session/PID/Console/Status`（Console 列显示 `127.0.0.1:<consolePort>`）；`--json` 输出同数据。
7. **config**：`VALID_KEYS = new Set(['workerEntry'])`；`resolveMerged` 改为 `process.env.BROWSERCLI_ENTRY ?? file.workerEntry`；帮助示例同步。
8. **sessions.ts（新建）**：四个命令 `open`（`ensureDaemon` + `hello` 回显 `{session, pid, consolePort}`；已在运行则报错提示 `-s=x close` 先关）、`close`（`stopSession`）、`list`（status 的数据函数复用）、`kill-all`（`killAllDaemons` + 清 stale session 文件）。
9. **app.ts cliCommands**：注册 `open, close, list, 'kill-all'`；**help.ts** 补四个命令的 description/usage；**index.ts** 导出面去掉 WorkerHttpClient 类型，新增 daemonClient 导出。
10. **删除** `WorkerHttpClient.ts`、其两个测试、`STREAM_CHANNELS` 的 ws 依赖；`browsercli/package.json` 依赖删 `ws`（先 `grep -rn "from 'ws'" browsercli/src` 确认 daemonClient 之外无引用；`open-browser.ts` 不受影响）。

- [ ] **Step 2: 更新单测断言到新接口**

`tool-dispatcher.test.ts`/`browser.test.ts`/`jobs.test.ts`/`status.test.ts`：把 fake `httpClient`（`invoke/connectBrowser/...`）换成 fake `WorkerContext.connect` 返回的 fake `DaemonConnection`（`request(method, params)` 按 method 分发断言参数）；测试名与断言语义保持等价（如 `invoke 传参` → `request('tool.invoke', {tool, params})`）。`status.test.ts` 改为：`BROWSERCLI_DAEMON_DIR` 指向写入两个假 session 文件（一个无监听 socket 的随机 pipePath）→ 断言一个 open 探测失败被 GC、表格/JSON 形状。新增 `sessions.test.ts`：open 对 `spawnDaemon`/`ensureDaemon` 用注入的 daemonDir + `BROWSERCLI_ENTRY=node -e` 假 entry 走通一次真实 spawn。

- [ ] **Step 3: 验证 + 提交**

```bash
npm --prefix browsercli test
npm --prefix browsercli run typecheck
npx prettier --write browsercli
git add browsercli
git commit -m "refactor(cli)!: switch all commands from HTTP client to daemon socket sessions"
```

---

### Task 8: 端到端集成测试（真实 daemon + 真实 CLI 包）

**Files:**
- Create: `tests/integration/daemonSocket.integration.test.ts`
- Test: 复用 `browsercli` 构建产物

**Interfaces:**
- Consumes: `build/src/index.js`（daemon 模式）、`browsercli/build`（CLI）
- Produces: CI 可运行的 socket 链路回归锚点

- [ ] **Step 1: 写集成测试**

```ts
// tests/integration/daemonSocket.integration.test.ts（node:test）
// before: tmp workspace 目录（含 .browsercli/ 标记）；env 注入
//   BROWSERCLI_DAEMON_DIR=<tmp>/daemon, BROWSERCLI_ENTRY=<repo>/build/src/index.js
// 1. spawn 真实 CLI: node browsercli/build/bin/browsercli.js -s=itest open （execFileSync + env）
//    断言 <daemonDir>/<hash>/itest.session 出现且含 consolePort
// 2. browsercli -s=itest list-tools --json → stdout JSON tools 数组非空（无需浏览器）
// 3. browsercli -s=itest call <某个不依赖浏览器的工具> —— 若全仓库无此类工具则跳过此步，
//    保底断言改为 call 不存在工具时 exit code 1 且 stderr 含 UNKNOWN_TOOL
// 4. browsercli -s=itest close → session 文件消失；daemon 进程 process.kill(pid,0) 抛 ESRCH（轮询 5s）
// after: kill -9 兜底清理 + rm tmp
```

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/integration/daemonSocket.integration.test.js`

- [ ] **Step 2: 处理 `browsercli-reliability.integration.test.ts`**

读该文件：凡走 `WorkerHttpClient`/HTTP 断言的用例，改为经 `daemonClient`（`ensureDaemon` + `request('tool.invoke')`）等价断言；纯 JobStore/WorkerActivityCoordinator 断言不动。无法等价迁移的用例删除并在 PR 描述注明。

Run: `npm run test:integration`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/integration
git commit -m "test(ipc): add end-to-end daemon socket integration coverage"
```

---

### Task 9: 文档、脚本与最终验证闭环

**Files:**
- Modify: `CLAUDE.md`（browsercli 段落 + 架构表）、`package.json` scripts、`docs/`（涉及 worker 启动的文档）、`browsercli/README*`（若存在）

- [ ] **Step 1: 同步描述**

1. `CLAUDE.md`：「仅通过 worker 的 `/api/v1` HTTP 契约通信」→「通过本地命名管道与 detached daemon 会话通信（`%LOCALAPPDATA%\browsercli\daemon` 注册表，自动拉起）」；架构表新增一行 `Daemon IPC | src/ipc/daemonServer.ts | 命名管道 NDJSON 方法分发（tools/browser/jobs/events）`。
2. `package.json` scripts：`cli:start`→`node build/src/index.js --daemon --browsercli-daemon`，`cli:worker:stop`→`browsercli close`，`cli:worker:status`→`browsercli list`；新增 `test:ipc`: `npm run build && node --require ./build/tests/setup.js --test build/tests/unit/ipc/*.test.js build/tests/integration/daemonSocket.integration.test.js`。
3. grep `docs/` 与 `README.md` 中 `/api/v1`、`Sekiro`、`rpcHost`、`WORKER_URL`，逐处更新（只改描述，不重写无关内容）。

- [ ] **Step 2: 最终变更验证闭环（CLAUDE.md 硬性要求，以最终 diff 为边界）**

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm --prefix browsercli test
npm run check-format
```

全部通过（若有失败：保留失败输出 → 修复 → 在最后一次代码修改后重跑同一命令）。

- [ ] **Step 3: 人工验收清单（Windows）**

```powershell
npm run build
browsercli open                # 拉起 default daemon，回显 pid/consolePort
browsercli list                # 显示 default · 127.0.0.1:8765 · open
Start-Process http://127.0.0.1:8765   # Web 控制台可用
browsercli browser connect --channel=chrome --headless
browsercli call get_page_info  # 或任一工具，返回结果
browsercli -s=proj open; browsercli list   # 两个会话并存、端口不同
browsercli close-all           # 或逐个 close
browsercli kill-all            # 强杀兜底
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "docs: align transport docs and scripts with daemon socket IPC"
```

---

## Self-Review 结论（已执行）

1. **规格覆盖**：裸 JSON socket（T1/T4/T6）、保留回环控制台 + 端口记录（T5/T7-status）、多会话 + 注册表 + 自动拉起 + 版本协商（T2/T5/T6）、kill-all/close/delete-data 兜底（T6/T7）、WORKER_BUSY 退避与断线中止（T4/T7）、Sekiro/远程全下线（T3）、事件流替代 --watch（T4 subscribe/T7 call）。无遗漏项。
2. **占位符扫描**：T4 `browser.disconnect`/`jobs.cancel` 两处标注「与 apiV1 相同，从 git HEAD~1 逐行移植」并给出精确源文件与语义描述 —— 这是对既有代码的迁移指令而非 TBD。其余步骤均含可运行代码或精确命令。
3. **类型一致性**：`SessionConfig` 字段、`resolveSessionName/explicitSessionName/makePipePath/computeClientInfo`、`PROTOCOL_VERSION`、方法名集合（hello/tools.list/tool.invoke/browser.*/jobs.*/subscribe/stop）在 T1-T7 间已对齐；`WorkerContext.connect` 在 T7 内部各命令使用一致。
