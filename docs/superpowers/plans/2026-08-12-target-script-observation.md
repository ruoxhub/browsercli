# Target 级脚本观测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 Patchright 的前提下，为 Chromium 增加显式、只读、一次性的 `list_targets` 与 `dump_target_scripts`，覆盖调用前已经创建的 Worker、SharedWorker、Service Worker、blob Worker 及其内部脚本，并补齐临时 Target Session 的容错与验证。

**Architecture:** 新建 `BrowserTargetInspector` 深模块，由它独占 browser-level CDP Session、非 flat Target 消息路由、脚本快照、去重与限额。工具层只做 schema 和结构化响应；`ToolContextProvider` 只提供惰性 Inspector 入口。任何 CDP 域都只在显式工具调用期间激活，不修改浏览器启动路径。

**Tech Stack:** TypeScript ESM、Patchright `Browser`/`CDPSession`、Chrome DevTools Protocol `Target`/`Debugger` 域、Node.js `crypto`/`events`/`node:test`、Zod。

## Global Constraints

- 本计划是三阶段交付的第 1 阶段；完成并通过真实 Chromium 门禁后，才执行 [稳定 pageId 计划](./2026-08-12-stable-page-id.md)，最后执行 [Context 持久 Hook 计划](./2026-08-12-context-persistent-hooks.md)。
- 规范来源是 [浏览器运行时基础能力设计](../specs/2026-08-12-browser-runtime-foundations-design.md)；实现采用 clean-room 行为重写，不复制 `open-source/jshookmcp` 的 AGPL 源码、类型或测试 fixture。
- 保留 Patchright，不引入 Puppeteer，不访问 Patchright 私有 API，不新增依赖。
- 不修改 `BrowserManager.launchBrowser()`、viewport、stealth 参数、profile 或 Cloak 分层。
- 不发送 `Target.setAutoAttach`、`Runtime.enable` 或 `Console.enable`；`Debugger.enable` 只能在显式 dump 的选定 Target 上短暂启用。
- 不复用 `PlaywrightDevToolsConnection`：它只能注册真实 Patchright `CDPSession` 对象，无法表示 `Target.attachToTarget(flatten:false)` 返回的原始 `sessionId`。
- 不复用 `SessionManager`：它负责 worker/page 所有权和 Storage 注入，不是 Target CDP 子会话注册表。
- 同一 `targetId` 的并发 dump 必须共享一个 in-flight Promise；不同 Target 不合并。
- 输出最多 200 个文件、单文件最多 200 KiB、源码总响应最多 512 KiB；所有大小使用 UTF-8 字节数。
- 所有命令有超时，所有 listener、pending Promise 和 Session 都必须在失败路径释放。
- `Target not found` 必须是可恢复错误；cleanup 失败只能成为 warning，不能覆盖主错误。
- 工作区已有用户改动。每次提交只暂存本计划列出的文件，不格式化、还原或提交无关文件。

---

## File Map

### 新建源码

- `src/modules/browser/TargetSessionRouter.ts`：仅供 Inspector 使用的非 flat JSON-RPC 子会话路由；维护双向映射、事件监听、pending 命令与超时。
- `src/modules/browser/BrowserTargetInspector.ts`：Target 枚举、临时附加、Debugger 快照、源码读取、去重、截断与结果聚合。
- `src/tools/collector/listTargets.ts`：`list_targets` MCP 薄适配。
- `src/tools/collector/dumpTargetScripts.ts`：`dump_target_scripts` MCP 薄适配。

### 新建测试与 fixture

- `tests/unit/browser/TargetSessionRouter.test.ts`
- `tests/unit/browser/BrowserTargetInspector.test.ts`
- `tests/unit/tools/collector/targetTools.test.ts`
- `tests/integration/browserTargetInspector.integration.test.ts`
- `tests/fixtures/browser-targets/index.html`
- `tests/fixtures/browser-targets/worker.js`
- `tests/fixtures/browser-targets/nested-worker.js`
- `tests/fixtures/browser-targets/shared-worker.js`
- `tests/fixtures/browser-targets/service-worker.js`

### 修改现有文件

- `src/modules/browser/CDPErrorMapper.ts`：增加 Target/Session 上下文、恢复提示和可恢复的 Target-not-found 分类。
- `src/modules/browser/index.ts`：只导出 Inspector 及其公共结果类型，不导出通用子会话 send 能力。
- `src/modules/collector/CollectedFileRegistry.ts`：导出并复用现有默认收集限额常量。
- `src/worker/ToolContext.ts`：惰性持有 `BrowserTargetInspector`。
- `src/tools/ToolDefinition.ts`：向内部工具 Context 增加 Inspector getter。
- `src/worker/DefineToolContextFactory.ts`：把 getter 映射到 `ToolContextProvider`。
- `src/tools/collector/manifest.ts`：注册两个 workflow 工具。
- `src/tools/generated-tools-index.ts`：由 `npm run build:index` 生成。
- `tests/unit/browser/CDPErrorMapper.test.ts`
- `tests/unit/modules/collector/CollectedFileRegistry.test.ts`

### 明确不改

- `src/modules/browser/DevToolsConnectionAdapter.ts`
- `src/modules/browser/SessionManager.ts`
- `src/modules/collector/PageScriptCollector.ts`
- `src/modules/collector/CodeCollector.ts`
- 浏览器启动、stealth、cloak 与 profile 相关文件

---

### Task 1: 固定共享限额和 CDP 可恢复错误语义

**Files:**

- Modify: `src/modules/collector/CollectedFileRegistry.ts`
- Modify: `tests/unit/modules/collector/CollectedFileRegistry.test.ts`
- Modify: `src/modules/browser/CDPErrorMapper.ts`
- Modify: `tests/unit/browser/CDPErrorMapper.test.ts`

**Interfaces:**

- Produces: `DEFAULT_COLLECTION_LIMITS`。
- Produces: `CDPErrorContext`。
- Changes compatibly: `mapCDPError(error, context?)`、`wrapCDPCall(fn, context?)`；原单参数调用保持有效。

- [ ] **Step 1: 先写共享限额失败测试**

在 `CollectedFileRegistry.test.ts` 增加断言：常量与无参数实例完全一致。

```typescript
import {
  CollectedFileRegistry,
  DEFAULT_COLLECTION_LIMITS,
} from '../../../../src/modules/collector/CollectedFileRegistry.js';

it('exports the canonical response limits used by target snapshots', () => {
  const registry = new CollectedFileRegistry();

  assert.equal(
    registry.MAX_FILES_PER_COLLECT,
    DEFAULT_COLLECTION_LIMITS.maxFilesPerCollect,
  );
  assert.equal(
    registry.MAX_SINGLE_FILE_SIZE,
    DEFAULT_COLLECTION_LIMITS.maxSingleFileSize,
  );
  assert.equal(
    registry.MAX_RESPONSE_SIZE,
    DEFAULT_COLLECTION_LIMITS.maxResponseSize,
  );
});
```

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/collector/CollectedFileRegistry.test.js
```

Expected: 编译失败，提示 `DEFAULT_COLLECTION_LIMITS` 尚未导出。

- [ ] **Step 2: 提取唯一默认值来源**

在 `CollectedFileRegistry.ts` 的 options 后增加：

```typescript
export const DEFAULT_COLLECTION_LIMITS = Object.freeze({
  maxCollectedUrls: 10_000,
  maxFilesCacheSize: 1_000,
  maxFilesPerCollect: 200,
  maxResponseSize: 512 * 1024,
  maxSingleFileSize: 200 * 1024,
});
```

构造函数改为逐项使用该常量；不得保留第二套数字字面量。

- [ ] **Step 3: 先写 CDP 错误上下文失败测试**

在 `CDPErrorMapper.test.ts` 增加：

```typescript
import {ToolError} from '../../../src/utils/errors.js';

it('maps a missing Target to a recoverable error with a fresh-list hint', () => {
  const result = mapCDPError(new Error('No target with given id found'), {
    targetId: 'target-gone',
  });

  assert.ok(result instanceof ToolError);
  assert.equal(result.code, 'NOT_FOUND');
  assert.equal(result.recoverable, true);
  assert.equal(result.context?.targetId, 'target-gone');
  assert.match(String(result.context?.recoveryHint), /list_targets/);
  assert.match(result.message, /list_targets/);
});

it('keeps session context on mapped detach errors', () => {
  const result = mapCDPError(new Error('Session closed'), {
    targetId: 'target-1',
    sessionId: 'session-1',
  }) as ToolError;

  assert.equal(result.context?.targetId, 'target-1');
  assert.equal(result.context?.sessionId, 'session-1');
  assert.match(String(result.context?.recoveryHint), /dump/);
});
```

Run the same build, then:

```powershell
node --require ./build/tests/setup.js --test build/tests/unit/browser/CDPErrorMapper.test.js
```

Expected: 类型检查或断言失败，因为 mapper 还没有 context 参数和 Target-not-found 模式。

- [ ] **Step 4: 兼容扩展 mapper，不修改全局 NOT_FOUND 默认值**

实现以下窄类型：

```typescript
export interface CDPErrorContext {
  recoveryHint?: string;
  targetId?: string;
  sessionId?: string;
}
```

把 `CDPErrorPattern` 增加可选 `recoveryHint` 与 `recoverable`，并增加模式：

```typescript
{
  pattern: /No target with given id|Target .* not found/i,
  code: ErrorCodes.NOT_FOUND,
  legacyName: 'CDP_TARGET_NOT_FOUND',
  message: 'Target 已关闭或不存在',
  recoveryHint: '请重新调用 list_targets，并使用最新的 targetId 重试。',
  recoverable: true,
}
```

`mapCDPError` 使用 `new ToolError(...)` 构造匹配错误，使该模式可覆盖 `NOT_FOUND` 的全局默认值；context 必须包含 `originalMessage`、调用方字段和 pattern 默认恢复提示。既有 stack/name 行为保持不变。

恢复提示同时拼入稳定的 `Error.message`，确保 HTTP/browsercli 路径（只保留 code/message）也能看到；
不要只放在 `ToolError.context`。

```typescript
export function mapCDPError(
  error: unknown,
  context: CDPErrorContext = {},
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const match = CDP_ERROR_PATTERNS.find(item => item.pattern.test(message));
  if (!match) return error instanceof Error ? error : new Error(message);

  const mapped = new ToolError(
    match.code,
    `${match.message}；${context.recoveryHint ?? match.recoveryHint ?? ''} (原始: ${message})`,
    {
      originalMessage: message,
      ...context,
      recoveryHint: context.recoveryHint ?? match.recoveryHint,
    },
    match.recoverable,
  );
  mapped.name = match.legacyName;
  if (error instanceof Error) mapped.stack = error.stack;
  return mapped;
}
```

为已有 Session、Target closed、Connection closed、timeout 模式补精确恢复提示；不要把权限或未知协议拒绝标成自动可重试。

- [ ] **Step 5: 运行聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/collector/CollectedFileRegistry.test.js build/tests/unit/browser/CDPErrorMapper.test.js
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 1**

```powershell
git add src/modules/collector/CollectedFileRegistry.ts tests/unit/modules/collector/CollectedFileRegistry.test.ts src/modules/browser/CDPErrorMapper.ts tests/unit/browser/CDPErrorMapper.test.ts
git commit -m "refactor(browser): share target snapshot limits"
```

---

### Task 2: 用 TDD 建立隔离的非 flat Target 子会话路由

**Files:**

- Create: `src/modules/browser/TargetSessionRouter.ts`
- Create: `tests/unit/browser/TargetSessionRouter.test.ts`

**Interfaces:**

- Consumes: Patchright `CDPSession` 根会话。
- Produces: 内部类 `TargetSessionRouter`，但不从 `src/modules/browser/index.ts` 导出。

```typescript
export type TargetEventListener = (
  params: Readonly<Record<string, unknown>>,
) => void;

export class TargetSessionRouter {
  constructor(rootSession: CDPSession, commandTimeoutMs?: number);
  registerSession(sessionId: string, targetId: string): void;
  unregisterSession(sessionId: string, reason?: Error): void;
  getSessionId(targetId: string): string | undefined;
  getTargetId(sessionId: string): string | undefined;
  on(
    sessionId: string,
    method: string,
    listener: TargetEventListener,
  ): () => void;
  send<T extends Record<string, unknown>>(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  dispose(reason?: Error): void;
}
```

- [ ] **Step 1: 建立可控根 Session fake**

测试内使用 `node:events` 的 `EventEmitter`，记录每个 root command，并允许主动发出 `Target.receivedMessageFromTarget`、`Target.detachedFromTarget` 与 `close`。fake 的 `send('Target.sendMessageToTarget', ...)` 只负责记录；测试从记录的 JSON payload 读出消息 ID，再发回响应。

- [ ] **Step 2: 写以下失败测试**

`TargetSessionRouter.test.ts` 必须逐项覆盖：

- 构造时立即监听根 Session，因此可以先构造、后 attach/register。
- `registerSession` 建立 `sessionId <-> targetId` 双向映射。
- 重复 sessionId、重复 targetId 被拒绝。
- `send` 生成单调 JSON-RPC ID，并经 `Target.sendMessageToTarget` 发出。
- 只处理属于本 sessionId 的响应和事件。
- 子命令协议错误拒绝对应 Promise，不影响其他 pending。
- `Target.detachedFromTarget` 拒绝该 session 的全部 pending 并清理映射。
- attach 返回到 `registerSession` 之间收到的 detach 记录为 early-detached tombstone；
  随后注册立即失败并消费 tombstone，不发送 child command。
- 根 Session `close` 拒绝所有 session 的 pending。
- 命令超过 `commandTimeoutMs` 后失败并移除 pending。
- `dispose` 移除三个根 listener；重复 dispose 无副作用。

关键成功路径测试形状：

```typescript
const root = new FakeRootSession();
const router = new TargetSessionRouter(root as never, 100);
router.registerSession('session-1', 'target-1');

const pending = router.send<{scriptSource: string}>(
  'session-1',
  'Debugger.getScriptSource',
  {scriptId: '7'},
);
const outbound = root.lastChildMessage();
root.receiveChildMessage('session-1', {
  id: outbound.id,
  result: {scriptSource: 'self.answer = 42;'},
});

assert.deepStrictEqual(await pending, {scriptSource: 'self.answer = 42;'});
```

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/browser/TargetSessionRouter.test.js
```

Expected: 编译失败，因为模块尚不存在。

- [ ] **Step 3: 实现路由的最小状态**

内部状态限定为：

```typescript
private nextMessageId = 1;
private readonly sessionToTarget = new Map<string, string>();
private readonly targetToSession = new Map<string, string>();
private readonly pending = new Map<
  string,
  {
    resolve(value: Record<string, unknown>): void;
    reject(reason: Error): void;
    timeout: NodeJS.Timeout;
  }
>();
private readonly listeners = new Map<
  string,
  Set<TargetEventListener>
>();
private readonly earlyDetachedSessions = new Set<string>();
private disposed = false;
```

pending key 使用 `${sessionId}:${messageId}`；event listener key 使用 `${sessionId}:${method}`。不要建立通用 connection facade，也不要把 router 注入 Runtime。

- [ ] **Step 4: 正确处理 send 竞态与协议错误**

`send` 必须先写入 pending，再 await 根命令，以允许响应早于根命令 Promise 完成。根命令失败时，只移除并拒绝当前 pending。子响应形状只接受以下字段：

```typescript
interface ChildProtocolMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: {code: number; message: string; data?: string};
}
```

JSON 解析失败、未知 message ID 和其他 session 的消息不得导致进程异常；解析失败仅使对应 session pending 失败，并带 `sessionId`/`targetId` context。

- [ ] **Step 5: 收敛 listener 生命周期**

构造函数绑定并注册三个稳定函数引用：

```typescript
rootSession.on('Target.receivedMessageFromTarget', this.handleReceivedMessage);
rootSession.on('Target.detachedFromTarget', this.handleDetached);
rootSession.on('close', this.handleRootClosed);
```

`dispose` 使用相同引用 `off`，清空 listener/映射，并以传入原因拒绝所有 pending。不得遗漏 timeout 的 `clearTimeout`。

- [ ] **Step 6: 运行聚焦测试并检查禁止命令**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/browser/TargetSessionRouter.test.js
rg -n "Target\.setAutoAttach|Runtime\.enable|Console\.enable" src/modules/browser/TargetSessionRouter.ts
```

Expected: 测试 PASS；`rg` 无输出并以 exit code 1 结束是预期结果。

- [ ] **Step 7: 提交 Task 2**

```powershell
git add src/modules/browser/TargetSessionRouter.ts tests/unit/browser/TargetSessionRouter.test.ts
git commit -m "feat(browser): add temporary target session router"
```

---

### Task 3: 用 TDD 实现 BrowserTargetInspector 快照门面

**Files:**

- Create: `src/modules/browser/BrowserTargetInspector.ts`
- Create: `tests/unit/browser/BrowserTargetInspector.test.ts`
- Modify: `src/modules/browser/index.ts`

**Interfaces:**

```typescript
export interface TargetSummary {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId?: string;
  openerId?: string;
  canDumpScripts: boolean;
}

export interface ScriptFailure {
  scriptId: string;
  url: string;
  reason: string;
  recoverable: boolean;
}

export interface DumpTargetScriptsResult {
  target: TargetSummary;
  scripts: CodeFile[];
  failures: ScriptFailure[];
  stats: {
    observed: number;
    returned: number;
    duplicates: number;
    failed: number;
    truncated: number;
    omitted: number;
    originalBytes: number;
    returnedBytes: number;
  };
  partial: boolean;
  warnings: string[];
}

export interface BrowserTargetInspectorOptions {
  commandTimeoutMs?: number;
  idleWindowMs?: number;
  maxObservationMs?: number;
  sourceConcurrency?: number;
  maxFiles?: number;
  maxSingleFileBytes?: number;
  maxResponseBytes?: number;
  maxScriptCacheBytes?: number;
}

export class BrowserTargetInspector {
  constructor(
    getBrowser: () => Browser | null,
    options?: BrowserTargetInspectorOptions,
  );
  listTargets(): Promise<TargetSummary[]>;
  dumpScripts(targetId: string): Promise<DumpTargetScriptsResult>;
}
```

- [ ] **Step 1: 先写枚举、平台与并发失败测试**

测试 fake Browser 只实现 `isConnected()`、`browserType().name()` 与 `newBrowserCDPSession()`。先覆盖：

- 未连接浏览器返回 `PREREQUISITE`。
- Firefox/WebKit 返回结构化可识别的 `VALIDATION`，不尝试 Page/fetch 降级。
- `Target.getTargets` 映射所有 Target；仅 `page`、`iframe`、`worker`、`shared_worker`、`service_worker` 的 `canDumpScripts=true`。
- `TargetInfo.attached=true` 仍使用独立临时 Session，不借用未知所有者的会话。
- 同一 Target 的 attach 返回后必须立即完成 session 注册；若根 listener 在注册前收到
  `Target.detachedFromTarget`，路由器要缓存该 session 的早期 detach 状态，注册后立即拒绝
  该会话，不能让后续 `Debugger.enable` 等待到超时。
- `listTargets` 总是在 finally detach 根 Session。
- 同一 Target 两次并发调用返回同一个 Promise 结果且只 attach 一次。
- 不同 Target 各 attach 一次。
- Promise resolve/reject 后 in-flight 记录被删除，下一次调用会重新快照。

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/browser/BrowserTargetInspector.test.js
```

Expected: 编译失败，因为 Inspector 尚不存在。

- [ ] **Step 2: 实现平台检查和 Target 映射**

allowlist 必须是封闭集合：

```typescript
const SCRIPT_TARGET_TYPES = new Set([
  'page',
  'iframe',
  'worker',
  'shared_worker',
  'service_worker',
]);
```

`getBrowser()` 返回 null、断连或非 Chromium 时分别给出明确错误。`listTargets()` 只调用 `Target.getTargets`，结果保持 CDP 顺序；不要启动 Target discovery。
Inspector 对根 Session 的 `Target.getTargets`、`Target.attachToTarget`、
`Target.detachFromTarget`、`session.detach()` 统一使用有界 timeout wrapper；cleanup 超时只写
warning，不能阻塞 handler。新增 fake Promise 永不 settle 的 get/attach/detach 测试，证明调用最终
返回或失败而不会永久挂起。

- [ ] **Step 3: 先写临时 attach、回放和 cleanup 失败测试**

增加 fake protocol 场景：

- 调用顺序是根 listener 已注册 -> `Target.attachToTarget({flatten:false})` -> router register -> `Debugger.scriptParsed` listener -> `Debugger.enable`。
- `Debugger.enable` 回放的事件在 idle window 后冻结。
- `Debugger.enable` 显式传入有限的 `maxScriptsCacheSize`，并对已观察的
  `scriptParsed` 数量设置上限；超限返回 `partial=true`/`omitted`，不得无限积累事件。
- 冻结后发出的新 `scriptParsed` 不进入本次结果。
- attach 成功、router register 抛错时仍调用 `Target.detachFromTarget` 和根 `detach()`。
- `Debugger.enable` 失败仍执行两层 detach。
- 成功时 best-effort `Debugger.disable`。
- cleanup 失败写入 warnings；若已有主错误，主错误类型和 message 不变。
- Target 在 attach 前消失，错误 `recoverable=true` 且提示重新 `list_targets`。
- 不支持的 Target type 在 attach 前失败。

- [ ] **Step 4: 实现严格的 dump 时序**

`dumpScripts` 仅负责同 Target in-flight 合并：

```typescript
dumpScripts(targetId: string): Promise<DumpTargetScriptsResult> {
  const existing = this.inFlight.get(targetId);
  if (existing) return existing;

  const pending = this.dumpScriptsOnce(targetId).finally(() => {
    this.inFlight.delete(targetId);
  });
  this.inFlight.set(targetId, pending);
  return pending;
}
```

`dumpScriptsOnce` 不在 try 内直接 return。使用 `result`、`primaryError` 和 `cleanupWarnings` 局部变量，finally 完成 cleanup 后再统一 return/throw，确保 warning 不丢失。

会话时序必须逐项实现：

1. `new BrowserTargetInspector` 本身不创建 Session。
2. 显式调用时创建 browser-level Session。
3. 先构造 `TargetSessionRouter`，让根 listener 在 attach 前就绪。
4. `Target.getTargets` 复核 Target。
5. `Target.attachToTarget({targetId, flatten: false})`。
6. `router.registerSession(sessionId, targetId)`；若 attach 与注册之间已缓存 detach，立即以可恢复
   错误结束，不发送 child command。
7. 先 `router.on(sessionId, 'Debugger.scriptParsed', listener)`。
8. 再 `router.send(sessionId, 'Debugger.enable', {maxScriptsCacheSize})`。
9. 等待 75ms idle window、最多 1,000ms；任一新 scriptParsed 重置 idle 计时。
10. 移除 script listener并冻结数组。
11. 读取源码并构造结果。
12. best-effort `Debugger.disable`。
13. finally 中 unregister、`Target.detachFromTarget`、router dispose、根 `detach()`。

cleanup 失败统一写入 `logger.warn`；若主错误为 `ToolError`，同时把字符串数组合并到
`ToolError.context.cleanupWarnings`，保持主错误 code/message/recoverable 不变。对应测试须断言
日志/上下文均可观察，不能静默吞掉 cleanup 结果。

默认 child command timeout 5,000ms、源码并发 4、`maxScriptCacheBytes` 2MiB、观察事件上限为
`maxFiles * 4`。options 允许单测缩短时间，但工具 schema 不暴露这些内部旋钮。

- [ ] **Step 5: 先写 CodeFile 映射、去重和限额失败测试**

覆盖：

- `service_worker -> service-worker`。
- `worker/shared_worker -> web-worker`。
- 有 URL 的 page/iframe -> `external`，无 URL -> `dynamic`。
- 无 URL 合成 `target://<targetId>/script/<scriptId>`。
- metadata 包含 source、targetId、targetType、scriptIds、cdpHash、位置与 sourceMapURL。
- 同 URL+同 CDP hash 合并 scriptIds；同 URL+不同 hash 保留。
- `scriptLanguage === 'WebAssembly'` 跳过文本源码映射并计入 omitted/warning。
- 零条有效 `scriptParsed` 返回成功的空快照（`partial=false`，stats 全为 0），只有协议/Target
  错误才失败。
- 无 CDP hash 时按源码 SHA-256 去重。
- 单个 `getScriptSource` 错误产生 `ScriptFailure`，其他脚本仍返回。
- UTF-8 多字节内容不会在截断边界产生超过上限的响应。
- 200 文件、200 KiB 单文件、512 KiB 总量三个上限独立生效。
- 达到上限后不再调度新 batch；已有 batch 内最多只有 `sourceConcurrency - 1` 个额外在途读取。
- stats 的 observed/returned/duplicates/failed/truncated/omitted/originalBytes/returnedBytes 精确。
- 任一失败、截断或省略使 `partial=true`。

- [ ] **Step 6: 实现 UTF-8 安全截断与有界批处理**

不要使用 `string.slice(0, byteLimit)`。实现按 Unicode code point 累计 UTF-8 字节的纯 helper：

```typescript
function truncateUtf8(
  content: string,
  maxBytes: number,
): {content: string; originalBytes: number; returnedBytes: number} {
  const originalBytes = Buffer.byteLength(content, 'utf8');
  if (originalBytes <= maxBytes) {
    return {content, originalBytes, returnedBytes: originalBytes};
  }

  let returnedBytes = 0;
  let end = 0;
  for (const char of content) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (returnedBytes + charBytes > maxBytes) break;
    returnedBytes += charBytes;
    end += char.length;
  }
  return {content: content.slice(0, end), originalBytes, returnedBytes};
}
```

源码读取以固定 batch 大小 `sourceConcurrency` 调度。每个 batch 完成后按 scriptParsed 顺序处理；若文件数或总字节达到上限，停止创建下一 batch，并把未调度项计入 omitted。不要对全部 scriptIds 使用无界 `Promise.all`。

去重键：

```typescript
const effectiveUrl =
  parsed.url || `target://${target.targetId}/script/${parsed.scriptId}`;
const contentHash =
  parsed.hash || createHash('sha256').update(scriptSource).digest('hex');
const dedupeKey = `${effectiveUrl}\u0000${contentHash}`;
```

`originalBytes` 和 `returnedBytes` 只累计实际成功读到源码的命令；未调度项不伪造原始大小。duplicate 不计 omitted，失败不计 omitted。

每个 `CodeFile.size` 必须等于最终返回 content 的 UTF-8 字节数；metadata 的 `originalSize`/`truncatedSize` 也使用字节数，不能使用 `string.length`。

- [ ] **Step 7: 导出稳定门面，不导出 router**

在 `src/modules/browser/index.ts` 增加：

```typescript
export {BrowserTargetInspector} from './BrowserTargetInspector.js';
export type {
  BrowserTargetInspectorOptions,
  DumpTargetScriptsResult,
  ScriptFailure,
  TargetSummary,
} from './BrowserTargetInspector.js';
```

不得从 index 导出 `TargetSessionRouter`。

- [ ] **Step 8: 运行 Inspector 单元测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/browser/TargetSessionRouter.test.js build/tests/unit/browser/BrowserTargetInspector.test.js build/tests/unit/browser/CDPErrorMapper.test.js
```

Expected: PASS。

- [ ] **Step 9: 提交 Task 3**

```powershell
git add src/modules/browser/BrowserTargetInspector.ts src/modules/browser/index.ts tests/unit/browser/BrowserTargetInspector.test.ts
git commit -m "feat(browser): inspect scripts from explicit targets"
```

---

### Task 4: 暴露两个 collector 工具并接入 worker Context

**Files:**

- Create: `src/tools/collector/listTargets.ts`
- Create: `src/tools/collector/dumpTargetScripts.ts`
- Create: `tests/unit/tools/collector/targetTools.test.ts`
- Modify: `src/worker/ToolContext.ts`
- Modify: `src/tools/ToolDefinition.ts`
- Modify: `src/worker/DefineToolContextFactory.ts`
- Modify: `src/tools/collector/manifest.ts`
- Modify: `src/tools/generated-tools-index.ts`

**Interfaces:**

- Adds internally: `Context.getBrowserTargetInspector()`。
- Adds: `ToolContextProvider.getBrowserTargetInspector()`。
- Adds tools: `list_targets`、`dump_target_scripts`。

- [ ] **Step 1: 先写薄 adapter 失败测试**

用只含 `getBrowserTargetInspector()` 的 mock Context 调用 handler，覆盖：

- `list_targets` 调用一次 `inspector.listTargets()`，成功 data 为 `{targets}`。
- `dump_target_scripts` 原样传递 `targetId`，成功 data 是完整 `DumpTargetScriptsResult`。
- 两个工具的 `annotations.readOnlyHint === true`。
- mapper 产生的 `ToolError` 被格式化到 `data.error`，保留 code、recoverable、targetId 与 recoveryHint。
- Inspector getter 缺失时返回清晰的运行时上下文错误，不读取 selected Page。

工具失败响应统一为：

```typescript
{
  success: false,
  message: formatted.message,
  tooltype,
  data: {error: formatted},
}
```

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/collector/targetTools.test.js
```

Expected: 编译失败，因为工具文件尚不存在。

- [ ] **Step 2: 在 ToolContextProvider 惰性持有 Inspector**

增加字段与 getter：

```typescript
private _browserTargetInspector?: BrowserTargetInspector;

getBrowserTargetInspector(): BrowserTargetInspector {
  this._browserTargetInspector ??= new BrowserTargetInspector(() =>
    this.getBrowser(),
  );
  return this._browserTargetInspector;
}
```

该 getter 只构造普通对象；不得创建 CDPSession、enable 域或枚举 Target。`dispose()` 不需关闭 Inspector 的常驻资源，因为 Inspector 不保留 Session；其每次调用自行 finally 清理。

- [ ] **Step 3: 扩展内部 Context 映射**

`ToolDefinition.ts` 的 `Context` 增加：

```typescript
getBrowserTargetInspector(): BrowserTargetInspector;
```

`DefineToolContextFactory.create()` 增加：

```typescript
getBrowserTargetInspector: () => provider.getBrowserTargetInspector(),
```

这是内部工具 Context 的增量能力；不要修改高扇入 `Runtime` interface。

- [ ] **Step 4: 实现两个只读工具**

`listTargets.ts` schema 为空；`dumpTargetScripts.ts` schema 为：

```typescript
schema: {
  targetId: zod.string().min(1).describe('从 list_targets 获取的 Target ID。'),
},
```

两个 handler 只调用 Context getter，不调用 `getSelectedPage()`，不访问 collector 缓存，不写 artifacts。

- [ ] **Step 5: 注册 manifest 并重建生成索引**

在 collector manifest 末尾添加：

```typescript
{modulePath: './collector/listTargets.js', handlerName: 'listTargets'},
{
  modulePath: './collector/dumpTargetScripts.js',
  handlerName: 'dumpTargetScripts',
},
```

Run:

```powershell
npm run build:index
```

Expected: `src/tools/generated-tools-index.ts` 出现两个新 entry，collector domain 仍是 workflow。

- [ ] **Step 6: 运行工具与注册测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/collector/targetTools.test.js build/tests/unit/tools/profile-coverage.test.js build/tests/unit/worker/verify_list_pages.test.js
```

Expected: PASS；现有不依赖选中页面的工具 Context 行为不回归。

- [ ] **Step 7: 提交 Task 4**

```powershell
git add src/tools/collector/listTargets.ts src/tools/collector/dumpTargetScripts.ts tests/unit/tools/collector/targetTools.test.ts src/worker/ToolContext.ts src/tools/ToolDefinition.ts src/worker/DefineToolContextFactory.ts src/tools/collector/manifest.ts src/tools/generated-tools-index.ts
git commit -m "feat(tools): expose target script snapshots"
```

---

### Task 5: 增加真实 Chromium Target 覆盖门禁

**Files:**

- Create: `tests/integration/browserTargetInspector.integration.test.ts`
- Create: `tests/fixtures/browser-targets/index.html`
- Create: `tests/fixtures/browser-targets/worker.js`
- Create: `tests/fixtures/browser-targets/nested-worker.js`
- Create: `tests/fixtures/browser-targets/shared-worker.js`
- Create: `tests/fixtures/browser-targets/service-worker.js`

**Interfaces:**

- Uses: 公共 `BrowserTargetInspector` 和 Patchright `chromium`。
- Gate: `RUN_BROWSER_TESTS === 'true'`。

- [ ] **Step 1: 创建独立 fixture**

每个脚本放唯一 marker，便于按源码断言：

```javascript
// worker.js
self.__ordinaryWorkerMarker = 'ordinary-worker-before-dump';
importScripts('/nested-worker.js');
self.onmessage = event => self.postMessage(event.data);
```

```javascript
// nested-worker.js
self.__nestedWorkerMarker = 'nested-import-script';
```

```javascript
// shared-worker.js
self.__sharedWorkerMarker = 'shared-worker-before-dump';
self.onconnect = event => event.ports[0].start();
```

```javascript
// service-worker.js
self.__serviceWorkerMarker = 'service-worker-before-dump';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event =>
  event.waitUntil(self.clients.claim()),
);
```

`index.html` 在加载时创建普通 Worker、由 Blob 构造的 Worker、SharedWorker，并注册 Service Worker；所有对象保存在 `window` 属性上，避免被垃圾回收。若要断言 iframe Target，
fixture 必须额外使用不同 origin（例如第二个随机端口）创建跨站 iframe，且只断言实际出现在
`Target.getTargets` 的 OOPIF；同 origin/同进程 iframe 不得作为独立 Target 的必测条件。

- [ ] **Step 2: 在测试内启动临时 HTTP server**

使用 `node:http`、`node:fs/promises` 与 `node:path`，只服务上述 fixture。监听 `127.0.0.1` 随机端口。`after` 中按顺序关闭 page/context/browser/server；任何一个 cleanup 失败不得阻止后续 cleanup。

- [ ] **Step 3: 先写真实浏览器断言**

测试 suite：

```typescript
const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';

describe(
  'BrowserTargetInspector Chromium integration',
  {
    skip: !runBrowserTests,
  },
  () => {
    // tests
  },
);
```

至少覆盖：

- 在构造 Inspector 和调用工具前，页面已收到 ordinary/blob worker 的 ready 消息。
- `listTargets()` 可观察 `worker`、`shared_worker`、`service_worker`；跨 origin iframe 仅在 Chromium
  报告 OOPIF Target 时断言 `iframe`。
- 对 ordinary Worker dump 能找到 ordinary marker 和 nested import marker。
- 对 blob Worker dump 能找到 blob marker，且 `CodeFile.url` 是 blob URL 或规范合成 URL。
- SharedWorker 与 Service Worker 各能读取自己的 marker。
- dump 中途终止 Worker 时，结果为 recoverable 失败或 `partial=true`，进程不挂起。
- 调用结束后再次执行 dump 会新 attach，而不是复用旧 sessionId。

- [ ] **Step 4: 运行真实 Chromium 门禁**

```powershell
$env:RUN_BROWSER_TESTS = 'true'
try {
  npm run build:dev
  node --require ./build/tests/setup.js --test build/tests/integration/browserTargetInspector.integration.test.js
} finally {
  Remove-Item Env:RUN_BROWSER_TESTS -ErrorAction SilentlyContinue
}
```

Expected: PASS。若本机缺少 Patchright Chromium，可记录阻塞，但不得把 skip 当作阶段通过。

- [ ] **Step 5: 提交 Task 5**

```powershell
git add tests/integration/browserTargetInspector.integration.test.ts tests/fixtures/browser-targets/index.html tests/fixtures/browser-targets/worker.js tests/fixtures/browser-targets/nested-worker.js tests/fixtures/browser-targets/shared-worker.js tests/fixtures/browser-targets/service-worker.js
git commit -m "test(browser): verify target script snapshots"
```

---

### Task 6: 阶段 1 最终 diff 验证与反检测审计

**Files:**

- Verify only; no planned source changes.

- [ ] **Step 1: 审查最终 diff 和禁止能力**

```powershell
git diff HEAD~5 -- src/modules/browser src/modules/collector/CollectedFileRegistry.ts src/tools/collector src/worker/ToolContext.ts src/tools/ToolDefinition.ts src/worker/DefineToolContextFactory.ts tests/unit/browser tests/unit/tools/collector tests/integration/browserTargetInspector.integration.test.ts tests/fixtures/browser-targets
rg -n "Target\.setAutoAttach|Runtime\.enable|Console\.enable" src/modules/browser/BrowserTargetInspector.ts src/modules/browser/TargetSessionRouter.ts
rg -n "newBrowserCDPSession|Debugger\.enable" src/modules/browser/browser.ts src/modules/browser src/index.ts
```

Expected:

- 第一条 diff 只含本计划文件。
- 第二条无输出。
- 第三条不得显示新增启动路径激活；只允许既有代码或本计划显式 Inspector 路径。

- [ ] **Step 2: 运行最终单元、类型与格式检查**

```powershell
npm run typecheck
npm run test:unit
npm run check-format
```

Expected: 全部 PASS，且结果来自最后一次代码修改之后。

- [ ] **Step 3: 运行完整 integration 与真实浏览器门禁**

```powershell
npm run test:integration
$env:RUN_BROWSER_TESTS = 'true'
try {
  npm run build:dev
  node --require ./build/tests/setup.js --test build/tests/integration/browserTargetInspector.integration.test.js
} finally {
  Remove-Item Env:RUN_BROWSER_TESTS -ErrorAction SilentlyContinue
}
```

Expected: 全部 PASS；真实浏览器测试不得处于 skipped。

- [ ] **Step 4: 检查工作区边界**

```powershell
git status --short
git diff --check
```

Expected: 无 whitespace error；用户原有脏文件保持原状，阶段 1 文件没有未提交修改。

## 阶段 1 完成门槛

- `list_targets` 与 `dump_target_scripts` 在 workflow profile 可用。
- 真实 Chromium 证明能抓取调用前已创建 Worker 的主脚本与内部 `importScripts` 脚本。
- blob Worker、SharedWorker、Service Worker 均有独立证据。
- 每次调用都释放根/子 Session 和 listener。
- 输出严格遵守 200 文件、200 KiB 单文件、512 KiB 总量。
- 未引入 Puppeteer、自动附加、后台监控或启动期 CDP 激活。
