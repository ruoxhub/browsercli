# Local Applications 进程级透明代理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现对标 mitmproxy 的 Local Applications 功能：接管 Windows 系统代理，仅对选定的本地应用做透明 MITM 抓包，其余应用经盲转发正常上网，进程退出/崩溃绝不留下断网状态。

**Architecture:** `SystemProxyManager` 负责注册表接管/还原（四项原子还原 + marker 快照自检 + `'exit'`/`'uncaughtException'` 同步钩子）；`ProcessConnectionTracker` 后台 500ms 周期刷新连接表、连接时纯内存同步反查 PID；`MitmProxyServer` 在 CONNECT/HTTP 入口按进程名分流——目标进程进解密链路（`CapturedExchange` 注入 `clientProcess`），非目标进程复用提取出的 `relayDirectConnect` 盲转发（含上游 SOCKS5 分支）。REST/MCP/UI 三面暴露配置与进程列表。

**Tech Stack:** Node stdlib（`child_process` 的 `spawn`/`spawnSync`、`net`、`node:test`）；无新增运行时依赖。前端沿用现有 React + zustand。

**Spec:** `docs/superpowers/specs/2026-09-05-local-applications-proxy-design.md`（已含 2026-09-05 评审修订，本计划严格按修订版实现）

## Global Constraints

- TypeScript ESM：导入带 `.js` 后缀、`node:` 前缀、type import 显式（`import type`）、按 ESLint 字母序分组。
- Prettier：`singleQuote`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`。
- 不新增任何运行时依赖。
- 注册表键路径（Windows）：`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`；接管四项 `ProxyEnable`/`ProxyServer`/`ProxyOverride`/`AutoConfigURL`，原子还原；marker 键名固定 `ReverserProxyOwner`。
- 退出钩子只挂 `'exit'` + `'uncaughtException'`，**不注册 SIGINT/SIGTERM**（`src/worker/daemonMain.ts:228-235` 已注册，避免冲突）。
- 端口表时效 1500ms、进程名缓存 TTL 30000ms、后台刷新间隔 500ms、刷新连续失败 10 次标记 `trackerDegraded`。
- 测试镜像目录：`src/modules/proxy/Foo.ts` ↔ `tests/unit/modules/proxy/Foo.test.ts`。
- 单元测试一律注入 mock 命令执行器，**绝不真改注册表**；`SystemProxyManager` 实机验证仅 Windows 手动验收。
- 每结束一个 Task 提交一次，Conventional Commits（`feat(proxy):`、`refactor(proxy):`、`feat(web):`、`test(proxy):` 等），不加 agent 署名。
- 运行测试命令：`npm run test:unit`（先 build）；只跑单文件用 `node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/<file>.test.js`。
- 新 MCP 工具必须同时登记 `src/tools/proxy/manifest.ts` + `src/tools/proxy/index.ts`，然后跑 `npm run build:index` 重新生成 `generated-tools-index.ts`（`package.json:57`）。

## 关键代码事实（执行者必读，避免撞代码现实）

- `MitmProxyServer` 构造函数签名（`src/modules/proxy/MitmProxyServer.ts:127-140`）：`(caManager, onCaptured, interceptor?, shouldBypass?, upstreamProxy?)`。Local Apps 通过**末尾追加两个可选参数**扩展：`processTracker?`, `localAppsConfigProvider?`。
- 现有 CONNECT bypass 分支在 `MitmProxyServer.ts:455-490`（含 SOCKS5 上游子分支 457-474）；本计划 Task 4 先把它提取为 `relayDirectConnect`，原 hostname-bypass 调用点改调它，行为零变化。
- `handleHttpRequest(req, res)` 签名无 socket，源端口取 `req.socket.remotePort`；`handleConnect(req, clientSocket, head)` 取 `clientSocket.remotePort`。
- `MitmModule` 构造：`new MitmModule(certsDir, onExchange?)`（`MitmModule.ts:70-77`）；`recordExchange` 在 `MitmModule.ts:177`。
- `RuntimeServices.getMitmModule()`（`src/runtime/RuntimeServices.ts:85-92`）是 MitmModule 唯一构造点。
- WS 推送链：`ProxyStore.events.on('capture')` → `ConsoleServer.ts:308-320` 广播 `proxy.request`（payload 现为 6 字段，需加 `clientProcess`）。REST 列表链：`MitmModule.listRequests()`（`MitmModule.ts:269-313`）→ `/api/proxy/requests`。
- Session 落库链（可选持久化）：`MitmModule` 的 `onExchange` 水槽 → `fromMitmExchange`（`src/modules/session/adapters/MitmRequestAdapter.ts`）→ `CapturedRequestInput`。**不扩展 session SQLite 表 schema**：`clientProcess` 经 Task 8 复用既有 `initiator` 列（JSON 字符串载荷），DB 列已存在、零迁移。注意 `CapturedRequestSummary`（列表摘要类型）目前**不含** `initiator`，Task 11 有对应前置小改动。
- 前端协议类型真理源 `src/web/types.ts`，`src/web-ui/src/lib/protocol.ts` 整体 re-export，改 `web/types.ts` 前端自动可见。
- store 数据流：请求列表来自 `session.request` WS 频道（`src/web-ui/src/routes/proxy.tsx:106-128` rAF 批量灌入 `useProxyStore.addBatch`），摘要类型 `CapturedRequestSummary`（`src/modules/session/types.ts:88-101`）。**注意**：session 摘要不走 ProxyStore 的 `proxy.request` 频道——UI 列表实际消费的是 session 链路。给列表 Badge 供数据的最小路径 = 让 `fromMitmExchange` 把 `clientProcess` 塞进 `initiator` 字段（JSON 字符串），详情/列表端到端零 schema 变更（`initiator` 列、`CapturedRequestSummary.initiator`、`SessionRequestDetail.initiator` 全链路已存在）。见 Task 8。
- mock SOCKS5 服务器的现成写法在 `tests/unit/modules/proxy/socks5.test.ts:60-130`，Task 6 直接复用该模式。
- 已有测试 `MitmProxyServer.test.ts:534`（「命中的 HTTPS CONNECT 走旁路且不产生 capture」）是 Task 4 重构的守护测试，重构后必须原样通过。

---

### Task 1: 类型扩展 + `matchesProcessName` 纯函数

**Files:**

- Modify: `src/modules/proxy/types.ts`（`CapturedExchange` 加可选字段；新增 `ClientProcessMeta`、`LocalAppsConfig`、`LocalAppsStatus`）
- Create: `src/modules/proxy/processMatch.ts`
- Modify: `src/modules/proxy/index.ts`（导出新符号）
- Test: `tests/unit/modules/proxy/processMatch.test.ts`

**Interfaces:**

- Consumes: 现有 `CapturedExchange`（`types.ts:8`）。
- Produces（后续所有 Task 依赖，签名逐字使用）:
  - `interface ClientProcessMeta { pid: number; name: string; path?: string }`
  - `CapturedExchange.clientProcess?: ClientProcessMeta`
  - `interface LocalAppsConfig { enabled: boolean; targets: string[]; systemProxyActive: boolean }`
  - `interface LocalAppsStatus extends LocalAppsConfig { trackerDegraded: boolean; systemProxyUnsupported: boolean }`
  - `matchesProcessName(target: string, name: string): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/modules/proxy/processMatch.test.ts
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {matchesProcessName} from '../../../../src/modules/proxy/processMatch.js';

describe('matchesProcessName', () => {
  it('大小写不敏感的精确匹配', () => {
    assert.strictEqual(matchesProcessName('wechat.exe', 'WeChat.exe'), true);
    assert.strictEqual(matchesProcessName('WeChat.exe', 'wechat.EXE'), true);
    assert.strictEqual(
      matchesProcessName('wechat.exe', 'wechatapp.exe'),
      false,
    );
  });

  it('target 无扩展名时自动补 .exe', () => {
    assert.strictEqual(matchesProcessName('wechat', 'WeChat.exe'), true);
    assert.strictEqual(matchesProcessName('curl', 'curl.exe'), true);
  });

  it('带路径的 target 取 basename 后匹配', () => {
    assert.strictEqual(
      matchesProcessName(
        'C:\\Program Files\\Tencent\\WeChat.exe',
        'WeChat.exe',
      ),
      true,
    );
    assert.strictEqual(matchesProcessName('/usr/bin/curl', 'curl'), true);
  });

  it('name 带路径时也取 basename', () => {
    assert.strictEqual(
      matchesProcessName('WeChat.exe', 'C:\\x\\WeChat.exe'),
      true,
    );
  });

  it('空串不匹配', () => {
    assert.strictEqual(matchesProcessName('', 'WeChat.exe'), false);
    assert.strictEqual(matchesProcessName('wechat', ''), false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | head -5`（或直接 `npm run test:unit`）
Expected: FAIL —— `Cannot find module './processMatch.js'` / 类型不存在。

- [ ] **Step 3: 最小实现**

```ts
// src/modules/proxy/processMatch.ts
/**
 * 进程名匹配（spec §3.3）：不区分大小写的可执行文件 basename 精确匹配；
 * target 无扩展名时自动补 .exe（wechat → wechat.exe）。
 */
const EXE_SUFFIX = '.exe';

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i === -1 ? p : p.slice(i + 1);
}

export function matchesProcessName(target: string, name: string): boolean {
  let t = basename(target.trim()).toLowerCase();
  const n = basename(name.trim()).toLowerCase();
  if (!t || !n) return false;
  if (!t.endsWith(EXE_SUFFIX) && !n.endsWith(EXE_SUFFIX)) {
    // 两侧都无扩展名：直接比
  } else if (!t.endsWith(EXE_SUFFIX)) {
    t += EXE_SUFFIX;
  }
  return (
    t === n || t === n.replace(/\.exe$/, '') || t.replace(/\.exe$/, '') === n
  );
}
```

（实现如上或等价；三条比较分支覆盖「一侧有扩展名一侧没有」的全部组合，测试 Step 1 是验收标准。）

`types.ts` 顶部新增（保持现有导出不动，只追加）：

```ts
export interface ClientProcessMeta {
  pid: number;
  name: string;
  path?: string;
}

// CapturedExchange 接口体内追加一个可选字段：
//   clientProcess?: ClientProcessMeta;

export interface LocalAppsConfig {
  enabled: boolean;
  targets: string[]; // 空数组代表全部进程
  systemProxyActive: boolean;
}

export interface LocalAppsStatus extends LocalAppsConfig {
  trackerDegraded: boolean;
  systemProxyUnsupported: boolean;
}
```

`src/modules/proxy/index.ts` 追加：

```ts
export {matchesProcessName} from './processMatch.js';
```

以及 type re-export 块追加 `ClientProcessMeta`、`LocalAppsConfig`、`LocalAppsStatus`（跟随现有 `export type {...} from './types.js'` 的格式）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "processMatch|pass|fail" | head -5`
Expected: PASS（新增 5 个用例全绿，存量测试不红）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/proxy/types.ts src/modules/proxy/processMatch.ts src/modules/proxy/index.ts tests/unit/modules/proxy/processMatch.test.ts
git commit -m "feat(proxy): add ClientProcessMeta types and matchesProcessName"
```

---

### Task 2: `ProcessConnectionTracker`（后台刷新 + 内存反查）

**Files:**

- Create: `src/modules/proxy/ProcessConnectionTracker.ts`
- Modify: `src/modules/proxy/index.ts`
- Test: `tests/unit/modules/proxy/ProcessConnectionTracker.test.ts`

**Interfaces:**

- Consumes: `ClientProcessMeta`（Task 1）。
- Produces:
  - `class ProcessConnectionTracker`
  - `constructor(runCommand?: RunCommand)`，`type RunCommand = (cmd: string, args: string[]) => Promise<string>`（默认实现 `execFile` promisify；测试注入 mock）
  - `listActiveNetworkProcesses(selfPid?: number): Promise<ProcessInfo[]>`
  - `getProcessByPortSync(port: number): ClientProcessMeta | null`（纯内存，过期返回 null）
  - `refresh(): Promise<void>`（拉全量连接表重建缓存）
  - `startBackgroundRefresh(intervalMs?: number): void` / `stopBackgroundRefresh(): void`
  - `isDegraded(): boolean`（连续失败 ≥10 次为 true）
  - `interface ProcessInfo { pid: number; name: string; path?: string; displayName?: string }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/modules/proxy/ProcessConnectionTracker.test.ts
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ProcessConnectionTracker} from '../../../../src/modules/proxy/ProcessConnectionTracker.js';

/** 中文 netstat 输出样本（本地化差异是真实风险，解析必须容错）。 */
const NETSTAT_SAMPLE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    127.0.0.1:54321    203.0.113.7:443    ESTABLISHED     14220',
  '  TCP    192.168.1.5:54322  93.184.216.34:80   ESTABLISHED     8940',
  '  TCP    [::1]:54323        [::1]:8888         ESTABLISHED     14220',
  '',
].join('\r\n');

function makeTracker(
  outputs: string[],
  failures = 0,
): {tracker: ProcessConnectionTracker; calls: {cmd: string; args: string[]}[]} {
  const calls: {cmd: string; args: string[]}[] = [];
  let i = 0;
  let failed = 0;
  const tracker = new ProcessConnectionTracker(async (cmd, args) => {
    calls.push({cmd, args});
    if (failed < failures) {
      failed += 1;
      throw new Error('command unavailable');
    }
    const out = outputs[Math.min(i, outputs.length - 1)];
    i += 1;
    return out;
  });
  return {tracker, calls};
}

describe('ProcessConnectionTracker', () => {
  it('refresh 解析 netstat 输出并按本地端口建索引', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    await tracker.refresh();
    assert.deepStrictEqual(tracker.getProcessByPortSync(54321), {
      pid: 14220,
      name: 'pid-14220',
    });
    assert.strictEqual(tracker.getProcessByPortSync(54322)?.pid, 8940);
  });

  it('IPv6 [::1]:port 也能索引', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    await tracker.refresh();
    assert.strictEqual(tracker.getProcessByPortSync(54323)?.pid, 14220);
  });

  it('未刷新或端口不存在返回 null（纯内存，不触发命令）', async () => {
    const {tracker, calls} = makeTracker([NETSTAT_SAMPLE]);
    assert.strictEqual(tracker.getProcessByPortSync(9999), null);
    assert.strictEqual(calls.length, 0);
  });

  it('条目超过 1500ms 视为过期返回 null', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    await tracker.refresh();
    // 用内部时钟偏移模拟老化：注入 Date.now 已不可行，改为验证 TTL 常量行为——
    // 直接构造过期：把 lastRefresh 时间戳改老。
    (tracker as unknown as {lastRefreshAt: number}).lastRefreshAt =
      Date.now() - 2000;
    assert.strictEqual(tracker.getProcessByPortSync(54321), null);
  });

  it('refresh 失败保留上次快照，连续 10 次后 isDegraded', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE], 10);
    await tracker.refresh(); // 成功一次
    assert.strictEqual(tracker.isDegraded(), false);
    for (let i = 0; i < 9; i++) await tracker.refresh();
    assert.strictEqual(tracker.isDegraded(), false);
    await tracker.refresh(); // 第 10 次失败
    assert.strictEqual(tracker.isDegraded(), true);
    // 快照仍在（失败不清缓存）
    assert.strictEqual(tracker.getProcessByPortSync(54321)?.pid, 14220);
  });

  it('listActiveNetworkProcesses 去重并排除 selfPid', async () => {
    const {tracker} = makeTracker([NETSTAT_SAMPLE]);
    const list = await tracker.listActiveNetworkProcesses(8940);
    const pids = list.map(p => p.pid);
    assert.ok(pids.includes(14220));
    assert.ok(!pids.includes(8940), '应排除代理自身 pid');
    assert.strictEqual(pids.filter(p => p === 14220).length, 1, 'pid 去重');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit 2>&1 | grep -iE "ProcessConnectionTracker|Cannot find" | head -3`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// src/modules/proxy/ProcessConnectionTracker.ts
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {logger} from '../../utils/logger.js';
import type {ClientProcessMeta} from './types.js';

const execFileAsync = promisify(execFile);

export type RunCommand = (cmd: string, args: string[]) => Promise<string>;

export interface ProcessInfo {
  pid: number;
  name: string;
  path?: string;
  displayName?: string;
}

const PORT_TTL_MS = 1500;
const PID_INFO_TTL_MS = 30_000;
const DEGRADED_THRESHOLD = 10;

/** 解析 netstat -ano 输出的 ESTABLISHED 行 → {localPort, pid}[]（容错本地化）。 */
export function parseNetstatOutput(
  out: string,
): {localPort: number; pid: number}[] {
  const rows: {localPort: number; pid: number}[] = [];
  for (const line of out.split(/\r?\n/)) {
    // 只认 TCP 行：前导空白 + "TCP" + 至少 4 列，末列是纯数字 PID
    const m = line.trim().match(/^TCP\s+\S+\s+\S+\s+\S+\s+(\d+)$/);
    if (!m) continue;
    const local = line.trim().split(/\s+/)[1] ?? '';
    const portMatch = local.match(/:(\d+)$/);
    if (!portMatch) continue;
    rows.push({localPort: Number(portMatch[1]), pid: Number(m[1])});
  }
  return rows;
}

export class ProcessConnectionTracker {
  private readonly portEntries = new Map<number, {pid: number; at: number}>();
  private readonly pidInfo = new Map<number, {info: ProcessInfo; at: number}>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private lastRefreshAt = 0;

  constructor(private readonly runCommand: RunCommand = defaultRunCommand) {}

  /** 拉全量连接表重建端口索引（spec §3.2 后台刷新模型）。 */
  async refresh(): Promise<void> {
    try {
      const out = await this.runCommand('netstat', ['-ano', '-p', 'tcp']);
      const now = Date.now();
      this.portEntries.clear();
      for (const {localPort, pid} of parseNetstatOutput(out)) {
        this.portEntries.set(localPort, {pid, at: now});
      }
      this.lastRefreshAt = now;
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      logger.debug('[ProcessTracker] refresh 失败，保留上次快照:', err);
    }
  }

  /** 纯内存查询；过期（>1500ms）或未命中返回 null。绝不 fork 子进程。 */
  getProcessByPortSync(port: number): ClientProcessMeta | null {
    const entry = this.portEntries.get(port);
    if (!entry) return null;
    if (Date.now() - entry.at > PORT_TTL_MS) return null;
    const cached = this.pidInfo.get(entry.pid);
    if (cached && Date.now() - cached.at <= PID_INFO_TTL_MS) {
      return {pid: entry.pid, name: cached.info.name, path: cached.info.path};
    }
    // 无进程名缓存时先回退占位名（refresh 进程名属 P1 增强，见 Step 3b）
    return {pid: entry.pid, name: `pid-${entry.pid}`};
  }

  async listActiveNetworkProcesses(selfPid?: number): Promise<ProcessInfo[]> {
    await this.refresh();
    const seen = new Map<number, ProcessInfo>();
    for (const {pid} of this.portEntries.values()) {
      if (pid === selfPid || pid === process.pid) continue;
      if (!seen.has(pid)) seen.set(pid, {pid, name: `pid-${pid}`});
    }
    return [...seen.values()];
  }

  startBackgroundRefresh(intervalMs = 500): void {
    this.stopBackgroundRefresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref?.();
  }

  stopBackgroundRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isDegraded(): boolean {
    return this.consecutiveFailures >= DEGRADED_THRESHOLD;
  }
}

async function defaultRunCommand(cmd: string, args: string[]): Promise<string> {
  const {stdout} = await execFileAsync(cmd, args, {timeout: 3000});
  return stdout;
}
```

**Step 3b（同任务内，进程名补全）**：上面 `name: 'pid-<pid>'` 只是占位——`getProcessByPortSync` 与 `listActiveNetworkProcesses` 需要在 pidInfo 未命中时尝试同步补全。为保持「连接路径绝不 fork」的 spec 约束，进程名补全只发生在 `refresh()` 内：解析出端口表后，对**新增 pid 集合**批量跑一次 `tasklist /FI "PID eq <pid>" /FO CSV /NH`（或 `wmic process where processid=<pid> get name,executablepath`），写入 `pidInfo` 缓存（TTL 30s）。mock 测试里 `runCommand` 的第二次调用会收到 `tasklist`——在 `makeTracker` 的 outputs 数组里相应提供 tasklist CSV 样本：

```ts
const TASKLIST_SAMPLE =
  '"WeChat.exe","14220","Console","1","123,456 bytes"\r\n';
```

并把 Step 1 第一个用例的断言从 `{pid: 14220, name: 'pid-14220'}` 改为 `{pid: 14220, name: 'WeChat.exe', path: undefined}`。实现细节：`refresh()` 内对每个新 pid 调 `runCommand('tasklist', ['/FI',`PID eq ${pid}`, '/FO', 'CSV', '/NH'])`，解析第一列进程名；获取不到（PowerShell/tasklist 不可用）时降级占位名 `pid-<pid>`，不算失败。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "ProcessConnectionTracker|pass [0-9]+|fail [0-9]+" | head -5`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/proxy/ProcessConnectionTracker.ts src/modules/proxy/index.ts tests/unit/modules/proxy/ProcessConnectionTracker.test.ts
git commit -m "feat(proxy): add ProcessConnectionTracker with background refresh model"
```

---

### Task 3: `SystemProxyManager`（注册表四项原子还原 + marker 机制）

**Files:**

- Create: `src/modules/proxy/SystemProxyManager.ts`
- Modify: `src/modules/proxy/index.ts`
- Test: `tests/unit/modules/proxy/SystemProxyManager.test.ts`

**Interfaces:**

- Consumes: 无（纯新模块）。
- Produces:
  - `interface SystemProxyState { enabled: boolean; server: string; override: string; autoConfigUrl: string }`
  - `class SystemProxyManager`
  - `constructor(opts?: {platform?: NodeJS.Platform; runCommand?: RunCommand; runCommandSync?: (cmd: string, args: string[]) => string})` —— platform 默认 `process.platform`，测试注入 `'win32'` + mock 命令执行器
  - `checkResidual(): Promise<boolean>`（marker 存在 → 按快照还原并删 marker，返回 true；无 marker 返回 false 绝不触碰）
  - `enable(port: number): Promise<void>`
  - `restore(): Promise<void>`
  - `restoreSync(): void`
  - `isActive(): boolean`
  - marker 键名 `ReverserProxyOwner`，值为 `JSON.stringify({version: 1, originalState})`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/modules/proxy/SystemProxyManager.test.ts
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {SystemProxyManager} from '../../../../src/modules/proxy/SystemProxyManager.js';

/**
 * 内存注册表 mock：键值存 Map，reg query/add/delete 直接操作它。
 * 命令序列断言靠 calls 记录。
 */
function makeManager(initial?: Record<string, string>) {
  const reg = new Map<string, string>(initial);
  const calls: {cmd: string; args: string[]}[] = [];
  const readReg = (args: string[]): string => {
    // reg query "<path>" /v <name>
    const name = args[args.length - 1];
    const v = reg.get(name);
    if (v === undefined) return ''; // reg query 找不到键时输出为空（解析层容错）
    return (
      `\r\n    ${name}    REG_SZ    ${v}\r\n` +
      (name === 'ProxyEnable' ? '' : '')
    );
  };
  const runSync = (cmd: string, args: string[]): string => {
    calls.push({cmd, args});
    if (cmd === 'reg' && args[0] === 'query') return readReg(args);
    if (cmd === 'reg' && args[0] === 'add') {
      // reg add "<path>" /v <name> /t <type> /d <data> /f
      const name = args[3];
      const data = args[args.indexOf('/d') + 1];
      reg.set(name, data);
      return '';
    }
    if (cmd === 'reg' && args[0] === 'delete') {
      reg.delete(args[3]);
      return '';
    }
    if (cmd === 'powershell') return '';
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  };
  const manager = new SystemProxyManager({
    platform: 'win32',
    runCommand: async (cmd, args) => runSync(cmd, args),
    runCommandSync: runSync,
  });
  return {manager, reg, calls};
}

const PROXY_ON = {
  ProxyEnable: '1',
  ProxyServer: 'proxy.corp:8080',
  ProxyOverride: 'corp.local',
  AutoConfigURL: 'http://pac.corp/wpad.dat',
};

describe('SystemProxyManager', () => {
  it('enable 备份四项原始值并写入接管配置', async () => {
    const {manager, reg} = makeManager(PROXY_ON);
    await manager.enable(8888);
    assert.strictEqual(reg.get('ProxyEnable'), '1');
    assert.strictEqual(reg.get('ProxyServer'), '127.0.0.1:8888');
    assert.strictEqual(
      reg.get('ProxyOverride'),
      'localhost;127.0.0.1;<-loopback>',
    );
    assert.strictEqual(reg.get('AutoConfigURL'), '');
    assert.ok(reg.get('ReverserProxyOwner'), 'marker 必须写入');
    assert.strictEqual(manager.isActive(), true);
  });

  it('restore 原子还原四项（含 PAC 与 Override）', async () => {
    const {manager, reg} = makeManager(PROXY_ON);
    await manager.enable(8888);
    await manager.restore();
    assert.strictEqual(reg.get('ProxyServer'), 'proxy.corp:8080');
    assert.strictEqual(reg.get('ProxyOverride'), 'corp.local');
    assert.strictEqual(reg.get('AutoConfigURL'), 'http://pac.corp/wpad.dat');
    assert.strictEqual(
      reg.get('ReverserProxyOwner'),
      undefined,
      '还原后删 marker',
    );
    assert.strictEqual(manager.isActive(), false);
  });

  it('restoreSync 用 spawnSync 完成同样还原（退出钩子路径）', async () => {
    const {manager, reg} = makeManager(PROXY_ON);
    await manager.enable(8888);
    manager.restoreSync();
    assert.strictEqual(reg.get('ProxyServer'), 'proxy.corp:8080');
    assert.strictEqual(reg.get('ReverserProxyOwner'), undefined);
  });

  it('checkResidual：marker 存在则按快照还原（不看端口），无 marker 绝不触碰', async () => {
    // 场景：上次非默认端口 9999 崩溃残留，本次启动端口 8888 也必须清理
    const snapshot = JSON.stringify({
      version: 1,
      originalState: {enabled: 0, server: '', override: '', autoConfigUrl: ''},
    });
    const {manager, reg} = makeManager({
      ProxyEnable: '1',
      ProxyServer: '127.0.0.1:9999',
      ReverserProxyOwner: snapshot,
    });
    const cleaned = await manager.checkResidual();
    assert.strictEqual(cleaned, true);
    assert.strictEqual(reg.get('ProxyEnable'), '0');
    assert.strictEqual(reg.get('ProxyServer'), '');
    assert.strictEqual(reg.get('ReverserProxyOwner'), undefined);

    // 无 marker：用户自己的代理配置，绝不触碰
    const {manager: m2, reg: reg2} = makeManager({
      ProxyEnable: '1',
      ProxyServer: 'user-proxy:1080',
    });
    const cleaned2 = await m2.checkResidual();
    assert.strictEqual(cleaned2, false);
    assert.strictEqual(reg2.get('ProxyServer'), 'user-proxy:1080');
  });

  it('marker 存在且代理活跃时二次 enable 被拒', async () => {
    const snapshot = JSON.stringify({
      version: 1,
      originalState: {enabled: 0, server: '', override: '', autoConfigUrl: ''},
    });
    const {manager, reg} = makeManager({
      ProxyEnable: '1',
      ProxyServer: '127.0.0.1:9999',
      ReverserProxyOwner: snapshot,
    });
    await assert.rejects(() => manager.enable(8888), /系统代理已被接管|active/);
    assert.strictEqual(
      reg.get('ProxyServer'),
      '127.0.0.1:9999',
      '被拒时不得改写',
    );
  });

  it('enable 后注册 exit/uncaughtException 钩子，且不注册 SIGINT/SIGTERM', async () => {
    const {manager} = makeManager(PROXY_ON);
    const before = {
      exit: process.listenerCount('exit'),
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    };
    await manager.enable(8888);
    assert.strictEqual(process.listenerCount('exit'), before.exit + 1);
    assert.strictEqual(process.listenerCount('uncaughtException') > 0, true);
    assert.strictEqual(
      process.listenerCount('SIGINT'),
      before.sigint,
      '不得注册 SIGINT',
    );
    assert.strictEqual(
      process.listenerCount('SIGTERM'),
      before.sigterm,
      '不得注册 SIGTERM',
    );
    await manager.restore();
    // restore 后可解除钩子（避免长生命周期进程累积 listener）
    assert.strictEqual(process.listenerCount('exit'), before.exit);
  });

  it('非 Windows 平台 enable 抛 systemProxyUnsupported', async () => {
    const manager = new SystemProxyManager({platform: 'linux'});
    await assert.rejects(() => manager.enable(8888), /unsupported/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit 2>&1 | grep -iE "SystemProxyManager|Cannot find" | head -3`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 最小实现**

```ts
// src/modules/proxy/SystemProxyManager.ts
import {spawnSync} from 'node:child_process';

import {logger} from '../../utils/logger.js';

export interface SystemProxyState {
  enabled: boolean;
  server: string;
  override: string;
  autoConfigUrl: string;
}

const REG_PATH =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const MARKER_KEY = 'ReverserProxyOwner';
const OVERRIDE_VALUE = 'localhost;127.0.0.1;<-loopback>';

interface ManagerOpts {
  platform?: NodeJS.Platform;
  runCommand?: (cmd: string, args: string[]) => Promise<string>;
  runCommandSync?: (cmd: string, args: string[]) => string;
}

interface InjectedDeps {
  platform: NodeJS.Platform;
  runCommand: (cmd: string, args: string[]) => Promise<string>;
  runCommandSync: (cmd: string, args: string[]) => string;
}

export class SystemProxyManager {
  private originalState: SystemProxyState | null = null;
  private hooked = false;
  private active = false;

  constructor(opts: ManagerOpts = {}) {
    // 生产默认实现内联在此（execFile promisify / spawnSync），
    // 测试注入覆盖。runCommandSync 默认 spawnSync，返回 stdout。
    // 具体装配见下方「实现要点」。
    void opts satisfies ManagerOpts;
    // （实现时直接把 opts 存为私有字段，默认值用三元补齐）
  }

  async checkResidual(): Promise<boolean> {
    const marker = await this.readMarker(); // reg query /v ReverserProxyOwner
    if (!marker) return false;
    const snap = this.parseMarker(marker);
    if (!snap) return false;
    await this.applyState(snap);
    await this.deleteMarker();
    return true;
  }

  async enable(port: number): Promise<void> {
    if (this.deps.platform !== 'win32') {
      throw new Error('systemProxyUnsupported');
    }
    // 单实例防护：marker 存在且 ProxyEnable=1 → 拒绝（spec §6.1）
    const marker = await this.readMarker();
    if (marker && (await this.readEnabled())) {
      throw new Error(
        '系统代理已被接管（检测到残留 marker），请先 restore 或重启 worker',
      );
    }
    this.originalState = await this.readState();
    await this.writeState({
      enabled: true,
      server: `127.0.0.1:${port}`,
      override: OVERRIDE_VALUE,
      autoConfigUrl: '', // PAC 置空，原值在快照里
    });
    await this.writeMarker();
    this.active = true;
    this.hookLifecycle();
  }

  async restore(): Promise<void> {
    const state = this.originalState ?? (await this.readMarkerState());
    if (state) await this.applyState(state);
    await this.deleteMarker();
    this.originalState = null;
    this.active = false;
    this.unhookLifecycle();
  }

  restoreSync(): void {
    try {
      const state = this.originalState ?? this.readMarkerStateSync();
      if (state) this.applyStateSync(state);
      this.deleteMarkerSync();
    } catch (err) {
      logger.warn('[SystemProxy] restoreSync 失败:', err);
    } finally {
      this.originalState = null;
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  // ── 私有：reg 读写封装、状态读写、marker 解析、生命周期钩子 ──
  // readState/applyState 走 runCommand（异步 reg add/query）；
  // applyStateSync/deleteMarkerSync/readMarkerStateSync 走 runCommandSync（spawnSync reg）；
  // hookLifecycle: process.on('exit') + process.on('uncaughtException')，各存引用便于 unhook；
  //   uncaughtException handler: restoreSync() 后 throw err（保持默认崩溃语义）；
  // applyState 按四项依次 reg add（enabled 用 REG_DWORD 0/1，其余 REG_SZ），
  //   末尾跑一次 PowerShell InternetSetOption 广播（模板抄 spec §3.1 的 PowerShell 片段，
  //   39=SETTINGS_CHANGED 37=REFRESH）；applyStateSync 同序 spawnSync。
  // writeMarker: reg add /v ReverserProxyOwner /t REG_SZ /d JSON.stringify({version:1, originalState})
  // readMarker 解析失败返回 null（当作用户数据，不触碰）。
}
```

**实现要点（写代码时照此补全私有方法，不要另行设计）**：

1. `readState()`：依次 `reg query` 四键；`ProxyEnable` 是 `REG_DWORD`，解析 `reg query` 输出的最后一列数字；其余键不存在时回退空串。解析用正则 `/REG_[A-Z_]+\s+(\S.*)$/` 取数据段。
2. 退化键值语义：还原 `ProxyEnable=0` 时 `ProxyServer`/`ProxyOverride`/`AutoConfigURL` 一并回写原值（哪怕原值为空也写空串，保证「原子还原四项」可断言）。
3. 生命周期钩子存 `this.onExit` / `this.onUncaught` 引用，`unhookLifecycle` 用 `process.removeListener` 解绑；`enable` 幂等（已 active 直接 return）。
4. 生产默认 `runCommand` = `execFile` promisify（timeout 3000），`runCommandSync` = `spawnSync` 取 `stdout.toString()`。
5. PowerShell 广播命令每次还原/接管后执行一次；失败只 `logger.debug`（广播失败不影响注册表已生效）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "SystemProxyManager|pass [0-9]+|fail [0-9]+" | head -5`
Expected: PASS（7 个用例全绿）。同时确认存量测试无红。

- [ ] **Step 5: Commit**

```bash
git add src/modules/proxy/SystemProxyManager.ts src/modules/proxy/index.ts tests/unit/modules/proxy/SystemProxyManager.test.ts
git commit -m "feat(proxy): add SystemProxyManager with 4-key atomic restore and marker residual check"
```

---

### Task 4: `relayDirectConnect` 提取重构（行为零变化）

**Files:**

- Modify: `src/modules/proxy/MitmProxyServer.ts:442-490`（`handleConnect` 的 bypass 分支提取为私有方法）
- Test: 存量 `tests/unit/modules/proxy/MitmProxyServer.test.ts`（守护，不新增文件）

**Interfaces:**

- Produces: `private relayDirectConnect(hostname: string, port: number, clientSocket: net.Socket, head: Buffer): void` —— Task 5/6 的分流出口。
- 行为契约：与现 bypass 分支逐字等价——`upstreamSocks5` 存在走 `connectSocks5` 隧道，否则 `net.connect`；写 `200 Connection Established`；错误只销毁 socket。

- [ ] **Step 1: 先跑存量守护测试建立基线**

Run: `npm run test:unit 2>&1 | grep -E "MitmProxyServer|pass [0-9]+|fail [0-9]+" | head -3`
Expected: PASS（记下用例数，重构后必须一致）。

- [ ] **Step 2: 提取方法**

把 `handleConnect` 中 `if (this.shouldBypass?.(hostname) === true) { ... return; }` 的整块（`MitmProxyServer.ts:455-490`，从 `if (this.upstreamSocks5) {` 到最后一个 `return;` 前）移入新私有方法：

```ts
/** 纯传输层盲转发（原 hostname-bypass 分支提取，spec §3.3）。含上游 SOCKS5 分支。 */
private relayDirectConnect(
  hostname: string,
  port: number,
  clientSocket: net.Socket,
  head: Buffer,
): void {
  if (this.upstreamSocks5) {
    connectSocks5(this.upstreamSocks5, {host: hostname, port})
      .then(tunnel => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) tunnel.write(head);
        tunnel.pipe(clientSocket);
        clientSocket.pipe(tunnel);
        tunnel.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => tunnel.destroy());
        tunnel.on('close', () => clientSocket.destroy());
        clientSocket.on('close', () => tunnel.destroy());
      })
      .catch(err => {
        logger.warn(
          `[MitmProxy] Bypass SOCKS5 connect error for ${hostname}:`,
          err.message,
        );
        clientSocket.destroy();
      });
    return;
  }

  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  const tunnel = net.connect(port, hostname, () => {
    if (head.length > 0) tunnel.write(head);
    tunnel.pipe(clientSocket);
    clientSocket.pipe(tunnel);
  });
  tunnel.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => tunnel.destroy());
  tunnel.on('close', () => clientSocket.destroy());
  clientSocket.on('close', () => tunnel.destroy());
}
```

原调用点替换为：

```ts
if (this.shouldBypass?.(hostname) === true) {
  this.relayDirectConnect(hostname, port, clientSocket, head);
  return;
}
```

- [ ] **Step 3: 跑全量测试确认零回归**

Run: `npm run test:unit 2>&1 | grep -E "MitmProxyServer|pass [0-9]+|fail [0-9]+" | head -3`
Expected: PASS，用例数与 Step 1 基线完全一致（尤其「命中的 HTTPS CONNECT 走旁路且不产生 capture」）。

- [ ] **Step 4: Commit**

```bash
git add src/modules/proxy/MitmProxyServer.ts
git commit -m "refactor(proxy): extract relayDirectConnect from bypass branch"
```

---

### Task 5: `MitmProxyServer` 进程分流 + `clientProcess` 注入

**Files:**

- Modify: `src/modules/proxy/MitmProxyServer.ts`（构造函数追加 2 个可选参数；`handleConnect`/`handleHttpRequest` 首部插分流；`relayResponse`/`emit` 注入 `clientProcess`）
- Test: `tests/unit/modules/proxy/MitmProxyServer.localApps.test.ts`

**Interfaces:**

- Consumes: `ProcessConnectionTracker.getProcessByPortSync`（Task 2）、`matchesProcessName`（Task 1）、`relayDirectConnect`（Task 4）、`ClientProcessMeta`/`LocalAppsConfig`（Task 1）。
- Produces:
  - 构造函数签名追加：`processTracker?: ProcessConnectionTracker`、`localAppsConfigProvider?: () => LocalAppsConfig`（放在现有 5 参之后）
  - 分流判定私有方法（供 CONNECT 与 HTTP 两入口复用）：
    `private resolveClientProcess<T extends net.Socket>(socket: T): {clientProcess?: ClientProcessMeta; bypass: boolean}` —— `config` 未启用时 `{undefined, false}`；`targets.length > 0` 且（无 clientProcess 或不匹配任一 target）时 `bypass: true`；否则 `bypass: false`
  - `onCaptured` 的 exchange 多带 `clientProcess`（`relayResponse` 的 `emit` 闭包加一个可选参数，两处调用点传入）

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/modules/proxy/MitmProxyServer.localApps.test.ts
import assert from 'node:assert';
import {mkdtempSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {CaManager} from '../../../../src/modules/proxy/CaManager.js';
import {MitmProxyServer} from '../../../../src/modules/proxy/MitmProxyServer.js';
import {ProcessConnectionTracker} from '../../../../src/modules/proxy/ProcessConnectionTracker.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';

/** 端口 → 进程 映射完全可控的 mock tracker。 */
function makeTracker(mapping: Record<number, {pid: number; name: string}>) {
  return {
    getProcessByPortSync: (port: number) => mapping[port] ?? null,
  } as unknown as ProcessConnectionTracker;
}

async function startOrigin(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('ok');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string')
        return reject(new Error('addr'));
      resolve({
        port: addr.port,
        close: () => new Promise<void>(r => server.close(() => r())),
      });
    });
  });
}

async function connectAndTalk(
  proxyPort: number,
  originPort: number,
): Promise<{statusLine: string; body: string}> {
  // 明文 HTTP 经代理：GET http://127.0.0.1:<originPort>/ （源端口由本测试进程持有，
  // 但 mock tracker 按 clientSocket.remotePort 索引——remotePort 是内核分配的临时端口，
  // 无法预知。因此本文件的用例统一用「全放行 + targets 命中/不命中」的组合：
  // tracker mock 返回固定进程名，与 targets 比对即可，无需知道真实端口。
  // 见下方各用例。
  void proxyPort;
  void originPort;
  throw new Error('helper unused');
}

describe('MitmProxyServer local-apps 分流', () => {
  it('非目标进程的 CONNECT 走盲转发：无 capture、无证书', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    let config = {
      enabled: true,
      targets: ['wechat.exe'],
      systemProxyActive: true,
    };
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}), // 所有端口都查不到进程 → null
      () => config,
    );
    await proxy.start(0);
    try {
      const established = await new Promise<boolean>(resolve => {
        const socket = net.connect(proxy.getPort()!, '127.0.0.1', () => {
          socket.write(
            `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n`,
          );
        });
        let buf = '';
        socket.on('data', d => {
          buf += d.toString('utf-8');
          if (buf.includes('200 Connection Established')) {
            socket.destroy();
            resolve(true);
          }
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(5000, () => {
          socket.destroy();
          resolve(false);
        });
      });
      assert.strictEqual(established, true, '盲转发也要回 200');
      assert.strictEqual(captured.length, 0, '不得产生 capture');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('全选模式（targets 为空）反查失败也放行解密链路', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}), // 反查全 null
      () => ({enabled: true, targets: [], systemProxyActive: true}),
    );
    await proxy.start(0);
    try {
      // 明文 HTTP 请求：全选模式应正常转发并 capture
      const res = await new Promise<{status: number; body: string}>(
        (resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: proxy.getPort()!,
              path: `http://127.0.0.1:${origin.port}/`,
              method: 'GET',
              headers: {host: `127.0.0.1:${origin.port}`},
            },
            r => {
              let body = '';
              r.on('data', (c: Buffer) => (body += c.toString()));
              r.on('end', () => resolve({status: r.statusCode ?? 0, body}));
            },
          );
          req.on('error', reject);
          req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('timeout'));
          });
          req.end();
        },
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(captured.length, 1);
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('非目标进程的明文 HTTP 请求：转发但不落库', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}), // null → 非目标
      () => ({enabled: true, targets: ['wechat.exe'], systemProxyActive: true}),
    );
    await proxy.start(0);
    try {
      const res = await new Promise<{status: number}>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.getPort()!,
            path: `http://127.0.0.1:${origin.port}/`,
            method: 'GET',
            headers: {host: `127.0.0.1:${origin.port}`},
          },
          r => resolve({status: r.statusCode ?? 0}),
        );
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.end();
      });
      assert.strictEqual(res.status, 200, '请求本身要成功');
      assert.strictEqual(captured.length, 0, '不落库');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('config.enabled=false 时不分流，一切如旧', async () => {
    const origin = await startOrigin();
    const captured: CapturedExchange[] = [];
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(
      ca,
      e => captured.push(e),
      undefined,
      undefined,
      undefined,
      makeTracker({}),
      () => ({enabled: false, targets: ['x.exe'], systemProxyActive: false}),
    );
    await proxy.start(0);
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.getPort()!,
            path: `http://127.0.0.1:${origin.port}/`,
            method: 'GET',
            headers: {host: `127.0.0.1:${origin.port}`},
          },
          () => resolve(),
        );
        req.on('error', reject);
        req.end();
      });
      assert.strictEqual(captured.length, 1, '关闭时正常 capture');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });
});
```

（删除未用的 `connectAndTalk` helper——上面保留只为说明为何按进程名而非真实端口断言。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit 2>&1 | grep -iE "localApps|local-apps" | head -3`
Expected: FAIL —— 构造函数不接受 7 参（TS 报错）或分流行为缺失导致断言失败。

- [ ] **Step 3: 实现**

1. 构造函数追加两个可选参数（放在 `upstreamProxy?` 之后）：

   ```ts
   processTracker?: ProcessConnectionTracker,
   localAppsConfigProvider?: () => LocalAppsConfig,
   ```

   存为 `private readonly processTracker?: ...` 与 `private readonly localAppsConfigProvider?: ...`。`import type {ProcessConnectionTracker} from './ProcessConnectionTracker.js';` + `import {matchesProcessName} from './processMatch.js';` + `import type {ClientProcessMeta, LocalAppsConfig} from './types.js';`

2. 新增私有判定方法：

   ```ts
   /**
    * 进程分流判定（spec §3.3）。纯内存同步，无子进程开销。
    * bypass=true 时调用方走 relayDirectConnect；clientProcess 供 capture 注入。
    */
   private resolveClientProcess(
     remotePort: number | undefined,
   ): {clientProcess?: ClientProcessMeta; bypass: boolean} {
     const config = this.localAppsConfigProvider?.();
     if (!config?.enabled) return {bypass: false};
     const clientProcess = remotePort
       ? (this.processTracker?.getProcessByPortSync(remotePort) ?? undefined)
       : undefined;
     if (config.targets.length > 0) {
       const isTarget =
         clientProcess != null &&
         config.targets.some(t => matchesProcessName(t, clientProcess.name));
       if (!isTarget) return {clientProcess, bypass: true};
     }
     return {clientProcess, bypass: false};
   }
   ```

3. `handleConnect` 在 `parseConnectAuthority` 校验后、`shouldBypass` 判定**之前**插入：

   ```ts
   const localApps = this.resolveClientProcess(clientSocket.remotePort);
   if (localApps.bypass) {
     this.relayDirectConnect(hostname, port, clientSocket, head);
     return;
   }
   ```

   并把 `localApps.clientProcess` 透传给解密路径：`handleDecryptedRequest(hostname, port, decryptedReq, decryptedRes)` 追加第 5 个可选参数 `clientProcess?: ClientProcessMeta`（miniServer 回调闭包里带上）。

4. `handleHttpRequest` 在 `targetUrl` 判空后插入：

   ```ts
   const localApps = this.resolveClientProcess(clientReq.socket.remotePort);
   if (localApps.bypass) {
     // 正向透传转发，不落库：复用现有转发逻辑但 shouldRecord=false 不够——
     // spec §3.3 要求"直接正向透传转发，不存入 ProxyStore"。
     // 实现：走现有转发路径，将 relayResponse 的 shouldRecord 置 false。
     this.forwardTransparent(clientReq, clientRes, localApps);
     return;
   }
   ```

   `forwardTransparent` = 复制现有 `handleHttpRequest` 转发主体（buffer body → http.request → relayResponse），`shouldRecord` 固定 `false`；或者更简：给现有主体加一个 `forceNoRecord` 内部参数（推荐后者，diff 最小）：`handleHttpRequest` 主体不动，把 `shouldRecord` 的计算改为 `const shouldRecord = !localApps.bypass && this.shouldBypass?.(parsed.hostname ?? '') !== true;` 并在入口分流后**直接 fall-through** 而非新方法——即非目标 HTTP 不提前 return，只影响 shouldRecord。选这条最小路径，删除 `forwardTransparent`。

5. `clientProcess` 注入 capture：`relayResponse`（`MitmProxyServer.ts:710`）追加可选参数 `clientProcess?: ClientProcessMeta`（放 `shouldRecord` 之后），`emit`（`:814`）里 spread：`...(clientProcess && {clientProcess})`。三个调用点（`:260` HTTP、`:581` HTTPS 解密）传入各自入口拿到的 `clientProcess`。WS upgrade 路径（`:343`）传 `undefined`（保持现状）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "local-apps|pass [0-9]+|fail [0-9]+" | head -3`
Expected: PASS（4 用例绿）+ 存量 MitmProxyServer 测试零回归。

- [ ] **Step 5: Commit**

```bash
git add src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.localApps.test.ts
git commit -m "feat(proxy): per-process traffic steering with clientProcess injection"
```

---

### Task 6: 上游 SOCKS5 盲转发回归测试（P0-1 守护）

**Files:**

- Test: `tests/unit/modules/proxy/MitmProxyServer.localApps.test.ts`（Task 5 文件内追加用例）

**Interfaces:**

- Consumes: Task 5 的分流行为、`tests/unit/modules/proxy/socks5.test.ts:60-130` 的 mock SOCKS5 模式。
- Produces: 无新接口，纯回归防护。

- [ ] **Step 1: 追加失败测试（若实现正确则直接绿——这是守护测试，允许先绿）**

在 Task 5 的 describe 块内追加：

```ts
it('配置上游 SOCKS5 时，非目标进程盲转发必须经 SOCKS5 隧道而非直连（P0-1 回归）', async () => {
  const origin = await startOrigin();
  let socksSawConnect = false;
  // mock SOCKS5 服务器（模式抄 socks5.test.ts:60-130）
  const socksServer = net.createServer(client => {
    let stage = 0;
    let remote: net.Socket | null = null;
    client.on('data', data => {
      if (stage === 0) {
        client.write(Buffer.from([0x05, 0x00]));
        stage = 1;
      } else if (stage === 1) {
        socksSawConnect = true;
        const atyp = data[3];
        let destHost = '';
        let destPort = 0;
        if (atyp === 0x01) {
          destHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
          destPort = data.readUInt16BE(8);
        } else if (atyp === 0x03) {
          const len = data[4];
          destHost = data.subarray(5, 5 + len).toString();
          destPort = data.readUInt16BE(5 + len);
        }
        remote = net.connect(destPort, destHost, () => {
          client.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x12, 0x34]),
          );
          stage = 2;
          client.pipe(remote!);
          remote!.pipe(client);
        });
        remote.on('error', () => client.destroy());
        client.on('error', () => remote?.destroy());
      }
    });
  });
  await new Promise<void>(r => socksServer.listen(0, '127.0.0.1', () => r()));
  const socksPort = (socksServer.address() as net.AddressInfo).port;

  const captured: CapturedExchange[] = [];
  const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
  await ca.init();
  const proxy = new MitmProxyServer(
    ca,
    e => captured.push(e),
    undefined,
    undefined,
    `socks5://127.0.0.1:${socksPort}`,
    makeTracker({}), // 反查 null → 非目标
    () => ({enabled: true, targets: ['wechat.exe'], systemProxyActive: true}),
  );
  await proxy.start(0);
  try {
    const established = await new Promise<boolean>(resolve => {
      const socket = net.connect(proxy.getPort()!, '127.0.0.1', () => {
        socket.write(
          `CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\n\r\n`,
        );
      });
      let buf = '';
      socket.on('data', d => {
        buf += d.toString('utf-8');
        if (buf.includes('200 Connection Established')) {
          socket.destroy();
          resolve(true);
        }
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    assert.strictEqual(established, true);
    assert.strictEqual(socksSawConnect, true, '必须经 SOCKS5 隧道');
    assert.strictEqual(captured.length, 0);
  } finally {
    await proxy.stop();
    socksServer.close();
    await origin.close();
  }
});
```

- [ ] **Step 2: 跑测试**

Run: `npm run test:unit 2>&1 | grep -E "local-apps|pass [0-9]+|fail [0-9]+" | head -3`
Expected: PASS。若 FAIL（`socksSawConnect === false`）说明 Task 5 分流绕过了 SOCKS5——修 `relayDirectConnect` 调用路径后再跑。

- [ ] **Step 3: Commit**

```bash
git add tests/unit/modules/proxy/MitmProxyServer.localApps.test.ts
git commit -m "test(proxy): guard SOCKS5 upstream path in per-process bypass"
```

---

### Task 7: `MitmModule` Local Apps 门面 + REST API + worker 自检

**Files:**

- Modify: `src/modules/proxy/MitmModule.ts`（Local Apps 状态持有与门面方法）
- Modify: `src/web/routes/proxy.ts`（3 个端点）
- Modify: `src/worker/daemonMain.ts`（启动时 `checkResidual`）
- Modify: `src/web/types.ts`（`LocalAppsStatus` re-export）
- Test: `tests/unit/modules/proxy/MitmModuleLocalApps.test.ts`
- Test: `tests/unit/web/routes/proxy.test.ts`（追加端点用例）

**Interfaces:**

- Consumes: `SystemProxyManager`（Task 3）、`ProcessConnectionTracker`（Task 2）、MitmProxyServer 新构造参数（Task 5）、`LocalAppsConfig`/`LocalAppsStatus`（Task 1）。
- Produces:
  - `MitmModule.getLocalAppsStatus(): LocalAppsStatus`
  - `MitmModule.configureLocalApps(params: {enabled?: boolean; targets?: string[]}): Promise<MitmMethodResult<LocalAppsStatus>>`
  - `MitmModule.listLocalProcesses(): Promise<MitmMethodResult<{processes: ProcessInfo[]}>>`
  - MitmModule 构造函数追加可选第 3 参：`new MitmModule(certsDir, onExchange?, systemProxy?: SystemProxyManager)`（默认内部 new；测试注入 mock）
  - REST：`GET /api/proxy/processes`、`GET /api/proxy/local-apps`、`POST /api/proxy/local-apps`
  - `MitmModule.stop()` 关停时若 Local Apps 活跃则先 `systemProxy.restore()` + `tracker.stopBackgroundRefresh()`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/modules/proxy/MitmModuleLocalApps.test.ts
import assert from 'node:assert';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import {SystemProxyManager} from '../../../../src/modules/proxy/SystemProxyManager.js';
import type {LocalAppsStatus} from '../../../../src/modules/proxy/types.js';

/** 全部方法 vi.fn 风格 mock（node:test 无 mock 库依赖，手写）。 */
function makeSystemProxyMock() {
  const state = {
    enabled: false,
    restored: 0,
    residualChecked: 0,
    lastPort: 0,
  };
  const manager = {
    isActive: () => state.enabled,
    enable: async (port: number) => {
      state.enabled = true;
      state.lastPort = port;
    },
    restore: async () => {
      state.enabled = false;
      state.restored += 1;
    },
    restoreSync: () => {
      state.enabled = false;
      state.restored += 1;
    },
    checkResidual: async () => {
      state.residualChecked += 1;
      return false;
    },
  } as unknown as SystemProxyManager;
  return {manager, state};
}

describe('MitmModule Local Apps 门面', () => {
  function makeModule() {
    const proxy = makeSystemProxyMock();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-local-apps-'));
    const mod = new MitmModule(dir, undefined, proxy.manager);
    return {mod, proxy};
  }

  it('初始状态：全关', () => {
    const {mod} = makeModule();
    const s = mod.getLocalAppsStatus();
    assert.deepStrictEqual(s, {
      enabled: false,
      targets: [],
      systemProxyActive: false,
      trackerDegraded: false,
      systemProxyUnsupported: false,
    });
  });

  it('configureLocalApps({enabled:true}) 自动启动代理并接管系统代理', async () => {
    const {mod, proxy} = makeModule();
    const result = await mod.configureLocalApps({
      enabled: true,
      targets: ['wechat.exe'],
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(proxy.state.enabled, true);
    assert.strictEqual(proxy.state.lastPort, mod.status().data.port);
    assert.deepStrictEqual(result.data?.targets, ['wechat.exe']);
    assert.strictEqual(result.data?.systemProxyActive, true);
  });

  it('configureLocalApps({enabled:false}) 还原系统代理', async () => {
    const {mod, proxy} = makeModule();
    await mod.configureLocalApps({enabled: true});
    await mod.configureLocalApps({enabled: false});
    assert.strictEqual(proxy.state.enabled, false);
    assert.strictEqual(mod.getLocalAppsStatus().enabled, false);
  });

  it('只更新 targets 不动开关', async () => {
    const {mod} = makeModule();
    await mod.configureLocalApps({enabled: true, targets: ['a.exe']});
    await mod.configureLocalApps({targets: ['b.exe', 'c.exe']});
    const s = mod.getLocalAppsStatus();
    assert.strictEqual(s.enabled, true);
    assert.deepStrictEqual(s.targets, ['b.exe', 'c.exe']);
  });

  it('stop() 时若 Local Apps 活跃先还原系统代理', async () => {
    const {mod, proxy} = makeModule();
    await mod.configureLocalApps({enabled: true});
    await mod.stop();
    assert.strictEqual(proxy.state.enabled, false, 'stop 必须还原系统代理');
    assert.strictEqual(mod.getLocalAppsStatus().enabled, false);
  });

  it('systemProxyUnsupported 传播到状态', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-local-apps-'));
    const unsupported = {
      isActive: () => false,
      enable: async () => {
        throw new Error('systemProxyUnsupported');
      },
      restore: async () => undefined,
      restoreSync: () => undefined,
      checkResidual: async () => false,
    } as unknown as SystemProxyManager;
    const mod = new MitmModule(dir, undefined, unsupported);
    const result = await mod.configureLocalApps({enabled: true});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.data?.systemProxyUnsupported, true);
  });
});
```

`tests/unit/web/routes/proxy.test.ts` 追加（复用现有 mockReq/mockRes 设施；**dispatch 签名是三参** `router.dispatch(req, res, path)`，照现有用例的调用形式；POST 端点的 enable 路径会真去启代理/接管系统代理——**测试里 MitmModule 是真实例**，需注入 mock SystemProxyManager：文件级 `new MitmModule(tmpDir)` 改为 `new MitmModule(tmpDir, undefined, mockSystemProxy)`——把 Task 3 测试同款的 `makeManager` mock 提为两个文件共享的 helper 不划算，直接在本文件内抄一份简版）：

```ts
describe('Local Apps REST endpoints', () => {
  it('GET /api/proxy/local-apps 返回初始配置', async () => {
    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/proxy/local-apps'),
      res as unknown as ServerResponse,
      '/api/proxy/local-apps',
    );
    assert.strictEqual(matched, true);
    const body = JSON.parse(res.body.toString());
    assert.strictEqual(body.enabled, false);
    assert.deepStrictEqual(body.targets, []);
    assert.strictEqual(body.systemProxyActive, false);
  });

  it('POST /api/proxy/local-apps 只更新 targets 时返回更新后配置', async () => {
    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('POST', '/api/proxy/local-apps', {targets: ['wechat.exe']}),
      res as unknown as ServerResponse,
      '/api/proxy/local-apps',
    );
    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body.toString());
    assert.strictEqual(body.enabled, false);
    assert.deepStrictEqual(body.targets, ['wechat.exe']);
  });

  it('GET /api/proxy/processes 返回列表结构', async () => {
    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/proxy/processes'),
      res as unknown as ServerResponse,
      '/api/proxy/processes',
    );
    assert.strictEqual(matched, true);
    const body = JSON.parse(res.body.toString());
    assert.ok(Array.isArray(body.processes));
  });
});
```

（`POST` 用例刻意**不传 enabled**——避免真实启动代理监听端口；enabled=true 的完整链路由 Task 7 的 MitmModuleLocalApps.test.ts 覆盖，那里 mock 了 SystemProxyManager。另注意：本文件 beforeEach 的 `new MitmModule(tmpDir)` 需改 `new MitmModule(tmpDir, undefined, makeMockSystemProxy())`，否则现有 POST /start 等用例不受影响、但新 POST 用例若误传 enabled 会真启代理。简版 mock：`{isActive: () => false, enable: async () => undefined, restore: async () => undefined, restoreSync: () => undefined, checkResidual: async () => false} as unknown as SystemProxyManager`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit 2>&1 | grep -iE "LocalApps|local-apps" | head -3`
Expected: FAIL。

- [ ] **Step 3: 实现 MitmModule 门面**

`MitmModule.ts` 追加（保持现有代码风格）：

```ts
// 新增私有字段（构造函数初始化）：
private localApps: LocalAppsConfig = {
  enabled: false,
  targets: [],
  systemProxyActive: false,
};
private readonly systemProxy: SystemProxyManager;
private readonly processTracker = new ProcessConnectionTracker();

// 构造函数追加第 3 可选参：
constructor(
  certsDir: string = resolveMitmCertsDir(),
  private readonly onExchange?: (exchange: CapturedExchange) => void,
  systemProxy?: SystemProxyManager,
) {
  // ... 现有逻辑不动 ...
  this.systemProxy = systemProxy ?? new SystemProxyManager();
}

getLocalAppsStatus(): LocalAppsStatus {
  return {
    ...this.localApps,
    trackerDegraded: this.processTracker.isDegraded(),
    systemProxyUnsupported: process.platform !== 'win32',
  };
}

async configureLocalApps(params: {
  enabled?: boolean;
  targets?: string[];
}): Promise<MitmMethodResult<LocalAppsStatus>> {
  try {
    if (params.targets !== undefined) this.localApps.targets = params.targets;
    if (params.enabled === undefined) {
      return {success: true, message: 'Local Apps 配置已更新', data: this.getLocalAppsStatus()};
    }
    if (params.enabled) {
      if (!this.server) {
        const started = await this.start();
        if (!started.success) return {success: false, message: started.message, data: this.getLocalAppsStatus()};
      }
      const port = this.server.getPort();
      if (port === null) throw new Error('代理端口未知');
      await this.systemProxy.enable(port);
      this.processTracker.startBackgroundRefresh();
      this.localApps.enabled = true;
      this.localApps.systemProxyActive = true;
    } else {
      await this.systemProxy.restore();
      this.processTracker.stopBackgroundRefresh();
      this.localApps.enabled = false;
      this.localApps.systemProxyActive = false;
    }
    return {success: true, message: `Local Apps 已${params.enabled ? '开启' : '关闭'}`, data: this.getLocalAppsStatus()};
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
      data: this.getLocalAppsStatus(),
    };
  }
}

async listLocalProcesses(): Promise<MitmMethodResult<{processes: ProcessInfo[]}>> {
  const processes = await this.processTracker.listActiveNetworkProcesses();
  return {success: true, message: `共 ${processes.length} 个联网进程`, data: {processes}};
}
```

同时：

1. `start()` 里 `new MitmProxyServer(...)` 调用追加两个实参：`this.processTracker` 与 `() => this.localApps`（放在 `effectiveUpstreamProxy` 之后）。**注意**：`this.server` 已存在时不重复构造的现有逻辑不变——但 Local Apps 开启时若 server 存在而 tracker/provider 未传（旧实例），需重建 server。简化处理：`start()` 改为总是传入这两个参数（server 不存在才 new，存在则忽略——因为构造时已带）。若 `configureLocalApps` 在 `start()` 之前从未调用过，默认 `localApps.enabled=false`，行为零变化。
2. `stop()` 首部插入：

   ```ts
   if (this.localApps.enabled || this.systemProxy.isActive()) {
     try {
       await this.systemProxy.restore();
     } catch {
       /* 已尽力 */
     }
     this.processTracker.stopBackgroundRefresh();
     this.localApps.enabled = false;
     this.localApps.systemProxyActive = false;
   }
   ```

- [ ] **Step 4: 实现 REST 端点**

`src/web/routes/proxy.ts` 的 routes Map 追加三个条目（照现有条目风格）：

```ts
[
  'GET /api/proxy/processes',
  async (_req, res) => {
    try {
      const result = await mitmModule.listLocalProcesses();
      sendJson(res, result.data);
    } catch (err) {
      sendUnexpected(res, err);
    }
  },
],
[
  'GET /api/proxy/local-apps',
  (_req, res) => {
    try {
      sendJson(res, mitmModule.getLocalAppsStatus());
    } catch (err) {
      sendUnexpected(res, err);
    }
  },
],
[
  'POST /api/proxy/local-apps',
  async (req, res) => {
    let enabled: boolean | undefined;
    let targets: string[] | undefined;
    try {
      const body = (await readJsonBody(req)) as {enabled?: boolean; targets?: string[]};
      if (typeof body === 'object' && body !== null) {
        if (typeof body.enabled === 'boolean') enabled = body.enabled;
        if (Array.isArray(body.targets)) {
          targets = body.targets.filter((t): t is string => typeof t === 'string');
        }
      }
    } catch (err) {
      sendError(res, 'INVALID_JSON', '请求体不是合法 JSON', 400);
      return;
    }
    try {
      const result = await mitmModule.configureLocalApps({enabled, targets});
      wsHub.broadcast('proxy.status', {...mitmModule.status().data, localApps: result.data});
      if (!result.success) {
        sendError(res, 'LOCAL_APPS_ERROR', result.message, 400);
        return;
      }
      sendJson(res, result.data);
    } catch (err) {
      sendUnexpected(res, err);
    }
  },
],
```

（`proxy.status` 广播 payload 追加可选 `localApps` 字段——`src/web/types.ts` 的 `ProxyStatusPayload` 加 `localApps?: LocalAppsStatus`，并 re-export 类型。）

- [ ] **Step 5: worker 启动自检**

`src/worker/daemonMain.ts` 的 `runDaemon` 里、`runtime` 取得后（`daemonMain.ts:100` 附近）插入：

```ts
// Local Apps 残留自检（spec §6.1）：上次崩溃未还原的系统代理在此清理。
try {
  const cleaned = await runtime.mitmModule
    .getSystemProxyManager()
    .checkResidual();
  if (cleaned) {
    console.warn('[Daemon] 检测到上次会话残留的系统代理配置，已自动还原');
  }
} catch {
  // 非 Windows 平台直接跳过
}
```

为此 `MitmModule` 暴露 `getSystemProxyManager(): SystemProxyManager { return this.systemProxy; }`。

- [ ] **Step 6: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "LocalApps|local-apps|processes|pass [0-9]+|fail [0-9]+" | head -6`
Expected: PASS（模块 6 用例 + REST 3 用例绿，存量零回归）。

- [ ] **Step 7: Commit**

```bash
git add src/modules/proxy/MitmModule.ts src/web/routes/proxy.ts src/web/types.ts src/worker/daemonMain.ts tests/unit/modules/proxy/MitmModuleLocalApps.test.ts tests/unit/web/routes/proxy.test.ts
git commit -m "feat(proxy): Local Apps facade with system proxy takeover and REST endpoints"
```

---

### Task 8: `clientProcess` 端到端透传（列表 Badge 数据链）

**Files:**

- Modify: `src/modules/session/adapters/MitmRequestAdapter.ts`（`clientProcess` → `initiator` JSON）
- Modify: `src/web/ConsoleServer.ts:308-320`（`proxy.request` 广播 payload 加 `clientProcess`）
- Test: `tests/unit/modules/session/adapters/MitmRequestAdapter.test.ts`（**已存在**，文件内有 `makeExchange` helper 与 4 个用例，追加用例即可，勿新建）

**Interfaces:**

- Consumes: `CapturedExchange.clientProcess`（Task 1/5）。
- Produces:
  - `fromMitmExchange` 输出的 `initiator` 字段：`clientProcess` 存在时为 `JSON.stringify({type: 'clientProcess', ...clientProcess})`，否则保持 `null`
  - WS `proxy.request` payload 追加可选 `clientProcess?: {pid: number; name: string}`
  - 前端 `SessionRequestSummary.initiator`（已存在字段）承载进程名——`ProxyRequestList.tsx` 在 Task 9 解析

- [ ] **Step 1: 写失败测试**

```ts
// 追加到现有 describe 内。用现有 makeExchange helper（它返回完整 CapturedExchange）：
// const ex = makeExchange({clientProcess: {pid: 14220, name: 'WeChat.exe', path: 'C:\\x\\WeChat.exe'}});

it('clientProcess 存在时序列化进 initiator', () => {
  const input = fromMitmExchange(
    makeExchange({
      clientProcess: {
        pid: 14220,
        name: 'WeChat.exe',
        path: 'C:\\x\\WeChat.exe',
      },
    }),
  );
  assert.strictEqual(
    input.initiator,
    JSON.stringify({
      type: 'clientProcess',
      pid: 14220,
      name: 'WeChat.exe',
      path: 'C:\\x\\WeChat.exe',
    }),
  );
});

it('无 clientProcess 时 initiator 保持 null', () => {
  const input = fromMitmExchange(makeExchange());
  assert.strictEqual(input.initiator, null);
});
```

（import 改动：现有文件 import 的是 `toCapturedRequestInput`，追加 `fromMitmExchange` 不必——同一函数的别名，直接用现有 `toCapturedRequestInput` 调用即可，两用例都改用它。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit 2>&1 | grep -iE "MitmRequestAdapter" | head -3`
Expected: FAIL —— initiator 为 null。

- [ ] **Step 3: 实现**

`MitmRequestAdapter.ts` 的 `toCapturedRequestInput` 里，`initiator: null` 改为：

```ts
initiator: exchange.clientProcess
  ? JSON.stringify({type: 'clientProcess', ...exchange.clientProcess})
  : null,
```

（注释一行说明：session 链路复用既有 initiator 列承载进程元数据，spec §3.3 透传契约的零 schema 变更路径。）

`ConsoleServer.ts` 的 `onProxyCaptureListener`（`:309-319`）payload 追加：

```ts
...(record.clientProcess && {
  clientProcess: {pid: record.clientProcess.pid, name: record.clientProcess.name},
}),
```

`src/web/types.ts` 的 `ProxyRequestSummaryEvent` 追加可选字段 `clientProcess?: {pid: number; name: string}`（`proxy.request` 频道 payload 契约同步）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "MitmRequestAdapter|pass [0-9]+|fail [0-9]+" | head -3`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/session/adapters/MitmRequestAdapter.ts src/web/ConsoleServer.ts src/web/types.ts tests/unit/modules/session/adapters/MitmRequestAdapter.test.ts
git commit -m "feat(session): carry clientProcess through initiator field and proxy.request WS payload"
```

---

### Task 9: MCP 工具（`mitm_list_local_processes` / `mitm_configure_local_apps`）

**Files:**

- Create: `src/tools/proxy/mitmListLocalProcesses.ts`
- Create: `src/tools/proxy/mitmConfigureLocalApps.ts`
- Modify: `src/tools/proxy/manifest.ts`、`src/tools/proxy/index.ts`
- Regenerate: `src/tools/generated-tools-index.ts`（跑 `npm run build:index`）
- Test: `tests/unit/tools/proxy/localAppsTools.test.ts`（若 tools 测试目录结构不同——先 `ls tests/unit/tools/` 确认，照现有工具测试的目录与写法放）

**Interfaces:**

- Consumes: `MitmModule.listLocalProcesses()` / `configureLocalApps()`（Task 7）、`defineTool` 模式（`src/tools/proxy/startMitmProxy.ts` 为模板）、`ToolCategory.NETWORK`。
- Produces: 两个 MCP 工具，参数与返回见 spec §4.2。

- [ ] **Step 1: 写失败测试**

先看 `ls tests/unit/tools/` 与任一现有 proxy 工具测试的写法，然后照模板写：

```ts
// tests/unit/tools/proxy/localAppsTools.test.ts（目录若不同按实际调整）
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {mitmListLocalProcesses} from '../../../../../src/tools/proxy/mitmListLocalProcesses.js';
import {mitmConfigureLocalApps} from '../../../../../src/tools/proxy/mitmConfigureLocalApps.js';

describe('local apps tools', () => {
  it('mitm_list_local_processes 注册元数据完整', () => {
    assert.strictEqual(
      mitmListLocalProcesses.name,
      'mitm_list_local_processes',
    );
    assert.ok(mitmListLocalProcesses.description.length > 0);
    assert.ok(mitmListLocalProcesses.handler);
  });

  it('mitm_configure_local_apps schema 含 enabled/targets', () => {
    assert.strictEqual(
      mitmConfigureLocalApps.name,
      'mitm_configure_local_apps',
    );
    assert.ok(mitmConfigureLocalApps.schema.enabled);
    assert.ok(mitmConfigureLocalApps.schema.targets);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit 2>&1 | grep -iE "localAppsTools|Cannot find" | head -3`
Expected: FAIL。

- [ ] **Step 3: 实现两个工具**

```ts
// src/tools/proxy/mitmListLocalProcesses.ts（头部 license + imports 照 startMitmProxy.ts 抄）
export const mitmListLocalProcesses = defineTool({
  name: 'mitm_list_local_processes',
  description:
    '列出当前正在发起或保持 TCP 连接的本地进程（pid/名称），辅助选取透明拦截目标。Windows 上基于 netstat 连接表。',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: true},
  schema: {},
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.listLocalProcesses();
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_list_local_processes',
    });
  },
});
```

```ts
// src/tools/proxy/mitmConfigureLocalApps.ts
export const mitmConfigureLocalApps = defineTool({
  name: 'mitm_configure_local_apps',
  description:
    '配置 Local Applications 透明拦截模式：接管 Windows 系统代理（127.0.0.1:<port>），仅对目标进程做 MITM 解密抓包，其余进程经盲转发正常上网。关闭时自动还原系统代理。targets 留空代表拦截全部本地应用。',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  schema: {
    enabled: zod.boolean().optional().describe('是否开启透明系统代理接管。'),
    targets: zod
      .array(zod.string())
      .optional()
      .describe(
        '拦截的目标进程名列表（如 ["wechat.exe"]，大小写不敏感，无扩展名自动补 .exe）。留空/空数组代表全部进程。',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.configureLocalApps({
      enabled: request.params.enabled,
      targets: request.params.targets,
    });
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_configure_local_apps',
    });
  },
});
```

（`schema` 的确切形状以 `defineTool` 的类型定义为准——照 `startMitmProxy.ts` 的 `schema: {port: zod.number()...}` 模式写。空 schema `{}` 若类型不收，改 `schema: {}` 为不传或按现有无参工具的写法——先 grep 一个无参工具（如 `stopMitmProxy.ts`）抄。）

`manifest.ts` 的 `tools` 数组追加两条：

```ts
{modulePath: './proxy/mitmListLocalProcesses.js', handlerName: 'mitmListLocalProcesses'},
{modulePath: './proxy/mitmConfigureLocalApps.js', handlerName: 'mitmConfigureLocalApps'},
```

`index.ts` 追加：

```ts
export {mitmListLocalProcesses} from './mitmListLocalProcesses.js';
export {mitmConfigureLocalApps} from './mitmConfigureLocalApps.js';
```

然后跑 `npm run build:index` 重新生成 `generated-tools-index.ts`（此脚本自动扫描 manifest，生成物直接提交）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit 2>&1 | grep -E "localAppsTools|tools contract|pass [0-9]+|fail [0-9]+" | head -5`
Expected: PASS —— 含 `all-tools-contract.test.js`（`tests/unit/tools/all-tools-contract.test.ts` 编译产物）自动覆盖新工具的注册完整性。

- [ ] **Step 5: Commit**

```bash
git add src/tools/proxy/ src/tools/generated-tools-index.ts tests/unit/tools/
git commit -m "feat(tools): add mitm_list_local_processes and mitm_configure_local_apps"
```

---

### Task 10: Web UI — `LocalAppsControl` 组件与 store 扩展

**Files:**

- Create: `src/web-ui/src/components/proxy/LocalAppsControl.tsx`
- Modify: `src/web-ui/src/components/proxy/ProxyControlBar.tsx`（嵌入组件）
- Modify: `src/web-ui/src/stores/proxy.ts`（Local Apps 状态 + actions）
- Modify: `src/web-ui/src/lib/api.ts`（3 个 API 方法）
- Test: `npm run typecheck` + `npm run web:build`（前端无单测框架，以类型与构建为验证门）

**Interfaces:**

- Consumes: REST 端点（Task 7）、`LocalAppsStatus` 类型（`protocol.ts` re-export 自 `web/types.ts`）、`useProxyStore`。
- Produces:
  - api: `getLocalApps(): Promise<LocalAppsStatus>`、`configureLocalApps(body: {enabled?: boolean; targets?: string[]}): Promise<LocalAppsStatus>`、`listLocalProcesses(): Promise<{processes: ProcessInfo[]}>`
  - store: `localApps: LocalAppsStatus | null`、`setLocalApps(s)`、`processes: ProcessInfo[]`、`setProcesses(list)`、`refreshProcesses(): Promise<void>`
  - `LocalAppsControl` 组件：开关 + chips + ProcessPicker Popover

- [ ] **Step 1: api.ts 追加方法**（照现有 `request<T>` 模式，加在 proxy 区块）：

```ts
getLocalApps(): Promise<LocalAppsStatus> {
  return request('GET', '/api/proxy/local-apps');
},
configureLocalApps(body: {enabled?: boolean; targets?: string[]}): Promise<LocalAppsStatus> {
  return request('POST', '/api/proxy/local-apps', body);
},
listLocalProcesses(): Promise<{processes: ProcessInfo[]}> {
  return request('GET', '/api/proxy/processes');
},
```

（类型从 `protocol` 导入：`import type {LocalAppsStatus} from './protocol';` + `ProcessInfo` 需要在 `src/web/types.ts` re-export——`export type {ProcessInfo} from '../modules/proxy/ProcessConnectionTracker.js';` 加进 web/types.ts。）

- [ ] **Step 2: store 扩展**（`stores/proxy.ts`，照现有字段/action 风格追加）：

```ts
localApps: null,
processes: [],
setLocalApps: (s) => set({localApps: s}),
setProcesses: (list) => set({processes: list}),
refreshProcesses: async () => {
  try {
    const res = await api.listLocalProcesses();
    set({processes: res.processes ?? []});
  } catch {
    set({processes: []});
  }
},
```

`ProxyState` interface 补对应字段与方法签名。

- [ ] **Step 3: LocalAppsControl 组件**（spec §5.1 的交互规格）：

```tsx
// src/web-ui/src/components/proxy/LocalAppsControl.tsx
// 结构（样式类名照 ProxyControlBar 现有约定抄，不引入新 UI 库）：
// - 外层容器（与其他控件同款的 border rounded-xl 容器）
// - [✓/空] 拦截本地应用 checkbox：onChange → api.configureLocalApps({enabled: checked})
// - 开启时：状态标签 [已接管系统代理]（高亮色）；
//   trackerDegraded 时改为 [进程识别不可靠]（警告色）
// - targets 展示：空 → [全部应用 ▾]；非空 → chips [WeChat.exe ×]...，× 点击 =
//   configureLocalApps({targets: targets.filter(t => t !== chip)})
// - [+] 按钮开 Popover：
//     顶部搜索框（本地模糊过滤 processes 列表）+ 回车添加自定义进程名
//     列表：processes.map(p => <label><input type=checkbox checked={targets 含 p.name}/> {p.name} ({p.pid})</label>)
//     勾选/取消 → configureLocalApps({targets: [...new Set([...targets, p.name])]}) / filter 移除
//     右上角 [↻] → refreshProcesses()
// - 关闭时：checkbox 之外的整块 disabled 灰态
// - systemProxyUnsupported 时 checkbox disabled + tooltip「当前平台不支持系统代理接管」
```

组件状态从 `useProxyStore` 取：`localApps`、`processes`；开启 Popover 时 `void refreshProcesses()`。开关切换后用返回的 `LocalAppsStatus` 调 `setLocalApps`。**进程名匹配用 `matchesProcessName` 的 UI 侧等价物**——直接把 checkbox 判定写成 `targets.some(t => t.toLowerCase() === p.name.toLowerCase() || t.toLowerCase() === p.name.toLowerCase().replace(/\.exe$/, ''))`（进程名来自服务端，无需再导纯函数过前端，避免跨包 import 后端模块）。

- [ ] **Step 4: 嵌入 ProxyControlBar**

`ProxyControlBar.tsx` 的 JSX 中、端口输入框区块之后（`ProxyControlBar.tsx:238` 端口区块后）插入：

```tsx
<LocalAppsControl />
```

import 加一行。组件不接 props，自取 store。

- [ ] **Step 5: 类型与构建验证**

Run: `npm run typecheck && npm run web:build`
Expected: 两者零错误。（web:build 内含 `tsc --noEmit -p src/web-ui/tsconfig.json`。）

- [ ] **Step 6: Commit**

```bash
git add src/web-ui/src/ src/web/types.ts
git commit -m "feat(web): LocalAppsControl with process picker and store wiring"
```

---

### Task 11: Web UI — 请求列表 Badge 与详情 Client Process 卡片

**Files:**

- Modify: `src/web-ui/src/components/proxy/ProxyRequestList.tsx`
- Modify: `src/web-ui/src/components/proxy/ProxyRequestDetail.tsx`
- Test: `npm run typecheck` + `npm run web:build`

**Interfaces:**

- Consumes: `SessionRequestSummaryEvent.initiator`（Task 8 的 JSON 载荷）、`SessionRequestDetail.initiator`。
- Produces: 列表 Badge `[💬 WeChat.exe]` / 详情 Client Process 卡片。

- [ ] **Step 1: 列表 Badge**

`ProxyRequestList.tsx` 顶部加纯函数（解析 Task 8 的 initiator JSON，容错非 JSON 值）：

```ts
function parseClientProcess(
  initiator: string | null,
): {pid: number; name: string} | null {
  if (!initiator) return null;
  try {
    const v = JSON.parse(initiator) as {
      type?: string;
      pid?: number;
      name?: string;
    };
    if (
      v?.type === 'clientProcess' &&
      typeof v.pid === 'number' &&
      typeof v.name === 'string'
    ) {
      return {pid: v.pid, name: v.name};
    }
  } catch {
    // 非 JSON（CDP initiator 等）按无进程处理
  }
  return null;
}
```

请求卡片标题行（现有 method/status badge 一行，`ProxyRequestList.tsx:117-140` 一带）追加：

```tsx
{
  (() => {
    const cp = parseClientProcess(req.initiator);
    return cp ? (
      <span
        className="px-1.5 py-0.5 rounded text-[9px] font-mono border shrink-0 bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-default)]"
        title={`pid: ${cp.pid}`}
      >
        💬 {cp.name}
      </span>
    ) : null;
  })();
}
```

（`req.initiator` 字段是否在列表类型上可见先确认：`CapturedRequestSummary` 有 `initiator`——没有。**列表摘要类型不含 initiator**（`src/modules/session/types.ts:88-101` 确实没有）。修正路径：给 `CapturedRequestSummary` 与 `toSummary`（`summary.ts`）与 `RequestSummaryDbRow` SELECT（`SqliteSessionStore.ts:327-331`）与 `listRequestSummaries` 全链加 `initiator` 字段——4 处一行改动，DB 列已存在无需迁移。在实现本 Task 时先做这个前置小改动，再写 UI。）

- [ ] **Step 2: 详情卡片**

`ProxyRequestDetail.tsx` 的 Overview 区块（找现有信息网格）追加一张卡片：

```tsx
{
  (() => {
    const cp = parseClientProcess(req.initiator);
    if (!cp) return null;
    // initiator JSON 里可能带 path（列表截断、详情全量）
    let path: string | undefined;
    try {
      const v = JSON.parse(req.initiator ?? '{}') as {path?: string};
      path = v.path;
    } catch {}
    return (
      <div className="border rounded-lg p-3 border-[var(--color-border-default)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
          Client Process
        </div>
        <div className="font-mono text-xs">{cp.name}</div>
        <div className="text-[10px] text-[var(--color-text-muted)]">
          PID {cp.pid}
        </div>
        {path && (
          <div className="text-[10px] text-[var(--color-text-muted)] break-all">
            {path}
          </div>
        )}
      </div>
    );
  })();
}
```

`parseClientProcess` 与列表共享——抽到 `src/web-ui/src/components/proxy/clientProcess.ts`（两组件 import），别复制两份。

- [ ] **Step 3: 类型与构建验证**

Run: `npm run typecheck && npm run web:build`
Expected: 零错误。

- [ ] **Step 4: Commit**

```bash
git add src/web-ui/src/ src/modules/session/types.ts src/modules/session/summary.ts src/modules/session/SqliteSessionStore.ts
git commit -m "feat(web): process badge in request list and Client Process card in detail"
```

---

### Task 12: 收尾验证闭环

**Files:**

- 无新文件；全量验证 + spec 状态更新。

- [ ] **Step 1: 全量检查**

Run:

```bash
npm run typecheck
npm run test:unit
npm run check-format
npm run web:build
npm run check-arch
```

Expected: 全部通过。任一失败：定位 → 修复 → **在同一最终 diff 上重跑全部五项**（AGENTS.md 最终变更验证闭环）。

- [ ] **Step 2: Windows 实机手动验收清单**（仅 Windows 开发机执行，CI 不跑）：

```text
[ ] 1. 启动 worker，curl http://127.0.0.1:<port>/ 直连正常（代理未接管）
[ ] 2. UI 开启「拦截本地应用」全选模式 → curl -x http://127.0.0.1:8888 https://example.com 正常返回且列表出现记录（clientProcess = curl.exe）
[ ] 3. targets 设为 [wechat.exe]，用浏览器访问任意站 → 浏览器流量不落库、无证书告警、网页正常
[ ] 4. 检查注册表：ProxyOverride 含 <-loopback>，marker 键 ReverserProxyOwner 存在
[ ] 5. 任务管理器强杀 worker 进程 → 注册表四项还原为接管前值，marker 消失
[ ] 6. 重启 worker → 无「残留已还原」告警（已被 5 验证清理）
[ ] 7. 模拟残留：手动 reg add marker（快照 JSON）+ ProxyEnable=1 → 重启 worker → 告警出现且代理被还原
[ ] 8. 配置上游 SOCKS5 + targets 只留某进程 → 非目标应用（浏览器）访问外网正常（经 SOCKS5）
```

- [ ] **Step 3: spec 状态更新**

`docs/superpowers/specs/2026-09-05-local-applications-proxy-design.md` 头部状态行追加「已实施（plan: 2026-09-05-local-applications-proxy.md）」。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-05-local-applications-proxy-design.md
git commit -m "docs(spec): mark local applications proxy design as implemented"
```
