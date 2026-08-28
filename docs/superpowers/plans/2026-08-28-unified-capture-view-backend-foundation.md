# 统一抓包视图 · 切片 1（后端地基）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变任何现有可观测行为的前提下，把 Session 持久层的"读侧摘要投影 + 默认会话 + 摄入错误隔离 + 配额 trim + 两条链路的字段 adapter"补齐，使切片 2 只需接线即可开工。

**Architecture:** `CaptureEngine` 成为唯一写入方与摘要投影方（`toSummary`），`CaptureSessionManager` 提供 `ensureActiveSession()`，`SqliteSessionStore` 提供 `getRequest/listRequestSummaries/trimRequests`；MITM 与 CDP 各有一个纯函数 adapter 把自有结构映射成 `CapturedRequestInput`；`RuntimeServices` 让 manager 与 engine 共享同一个 `SqliteSessionStore`/`DatabaseManager`。本切片**不接任何生产者、不动 WS 频道、不动前端**。

**Tech Stack:** TypeScript ESM（Node `^20.19.0 || ^22.12.0 || >=23`）、`better-sqlite3`、`node:test`（经 `npm run build` 后跑 `build/tests/**`）、Prettier + ESLint。

**Spec:** `docs/superpowers/specs/2026-08-28-unified-capture-view-design.md`（r2.1；本计划实现其 §14 的「切片 1」，对应 §4/§5/§5.1/§6/§7/§8 摘要投影/§9 配额部分）

## Global Constraints

- Node 版本：`^20.19.0 || ^22.12.0 || >=23`（`package.json` engines）。
- Prettier：`singleQuote: true`、`trailingComma: 'all'`、`arrowParens: 'avoid'`、`endOfLine: 'lf'`、`bracketSpacing: false`（`.prettierrc.cjs`）。
- ESLint：导入按字母序分组（`node:` 内置最先，相对路径其后）、类型导入必须显式 `import type`、优先 `interface` 而非 `type` 对象、Node 内置模块加 `node:` 前缀。
- 导入排序细则（`eslint.config` 的 `import/order`：`newlines-between: 'always'`、`alphabetize.caseInsensitive: true`）：分组顺序为 `node:` 内置 → 裸包（如 `patchright`、`better-sqlite3`）→ 上级 `../` → 同级 `./`，组间空一行、组内按路径字符串不区分大小写排序。例：`'./CaptureSessionManager.js'` → `'./constants.js'` → `'./SessionStore.js'` → `'./summary.js'` → `'./types.js'`。每个 Task 的 `check-format` 若报 `import/order`，跑 `npx eslint --fix <file>` 后重跑，不要手工猜顺序。
- 每个文件顶部保留既有 `@license` 头（`Copyright 2026 Google LLC` / `Apache-2.0`，与同目录文件一致）。
- 测试目录镜像源码：`src/modules/session/X.ts` → `tests/unit/modules/session/X.test.ts`。
- **零行为变更红线**：不改 `src/web-ui/**`、不改 `src/web/**`、不改 `proxy.request` 频道、不改 `src/tools/**`、不新增 CDP 域、不改 `NetworkRequestCollector`（spec §4/§12/§14.1）。
- 常量单一来源：会话配额放 `src/modules/session/constants.ts`，传输/取体放 `src/modules/network/constants.ts`（spec §9）。
- 每个 Task 收尾必跑：`npm run typecheck` + 该 Task 的单测 + **文件级**门禁（`npx prettier --check <本 Task 改动文件>`、`npx eslint <本 Task 改动文件>`）；最后一次改动后重跑同一组检查（AGENTS.md「最终变更验证闭环」）。
- **不要用 `npm run check-format` 当门禁**（实测 2026-08-28）：`eslint --cache .` 会连 `open-source/` 一起扫并在默认堆下 OOM；`prettier --check --cache .` 对 402 个文件报 warn（`docs/skills/**`、`docs/CDP/**` 的 vendored 文档为主，另有 `src/tools/**` 34 个、`tests/unit/**` 10 个）。这些是既有债务，本切片**不得顺手全量格式化**（无关 diff 会淹掉 review）。本计划涉及的 17 个源/测试文件当前全部是 prettier-clean，所以文件级门禁可以做到零 warn。
- 提交信息用 Conventional Commits（`feat(session): ...` / `refactor(network): ...` / `test(...)`）。
- **工作区卫生**：开工前工作区已有与本切片无关的改动（`AGENTS.md`、`CLAUDE.md`、`src/modules/browser/**`、`src/tools/**`、`skills/**` 等）。每个 Task 的 `git add` 只列本 Task 显式文件，**禁止 `git add -A` / `git commit -a`**；提交前用 `git status --porcelain` 确认暂存区只有自己的文件。
- 单测运行模板（把 `<path>` 换成 build 下路径）：

  ```bash
  npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/<path>.test.js
  ```

---

### Task 0: 记录既有红名单（防被自己的计划误判）

**Files:** 无（只测不改）

**Interfaces:**

- Consumes: 无
- Produces: 一份「开工前基线」，后续所有 "Expected: 全 PASS" 都相对它判断

- [ ] **Step 1: 跑全量单测并记下红名单**

Run:

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=8192"
npm run test:unit 2>&1 | Tee-Object .baseline_unit.txt | Select-String '^# (tests|pass|fail)'
(Select-String -Path .baseline_unit.txt -Pattern '^not ok ').Line
Remove-Item .baseline_unit.txt
```

实测基线（2026-08-28，未含本切片任何改动）：**1531 tests / 1474 pass / 57 fail**，19 个顶层红名单：
`BrowserManager mocked`、`browser.ts mocked`、`reverse workflow docs`、`console and network formatters`、`root-logger`、`CodeCollector extended helpers`、`CodeCollector defensive guards`、`CodeCollector logic`、`PageController`、`StealthScripts2025`、`OpenAIProvider (mocked)`、`tools extended coverage`、`collect_code tool-layer error handling`、`debugger tools error paths`、`debugger tools extended`、`buildPausedInfoData`、`rebuild bridge tools`、`traceSignatureGeneration`、`Configuration Management`。

- [ ] **Step 1b: 记录集成基线**

Run: `npm run test:integration`（同样带 `NODE_OPTIONS=--max-old-space-size=8192`）
Expected: 记下 `# tests / # pass / # fail` 与 `not ok` 名单，作为 Task 9 Step 2 的对照。本计划写作时该命令运行超过 5 分钟未返回（集成用例含真实浏览器/服务依赖），所以**基线数字必须开工时实测填写，不得照抄本文件**。若同样长时间不返回，把集成门禁记为「不可用」，改以定向用例兜底：

```powershell
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/integration/session/session-ai-pipeline.integration.test.js
```

- [ ] **Step 2: 确认本切片涉及的测试文件不在红名单内**

`tests/unit/modules/session/**`、`tests/unit/modules/collector/CdpNetworkMonitor.test.ts`、`tests/unit/runtime/RuntimeServices.test.ts`、`tests/unit/worker/**`、`tests/unit/web/ConsoleServer.test.ts` 当前**全绿**。所以后续 Task 里"Expected: 全 PASS"对这些文件是硬要求；出现红名单外的新失败 = 本切片引入的回归，必须当场定位（`systematic-debugging`），不得当作既有噪声。

---

### Task 1: 常量与文本类型判定的单一来源

**Files:**

- Create: `src/modules/session/constants.ts`
- Create: `src/modules/network/constants.ts`
- Create: `src/modules/network/contentType.ts`
- Modify: `src/modules/network/NetworkModule.ts:77`（删本地 `TEXTUAL_CONTENT_TYPES`）与 `:99-101`（删本地 `isTextualContentType`）
- Modify: `src/modules/proxy/MitmProxyServer.ts:23`（`MAX_BODY_SIZE` 改引共享常量）
- Test: `tests/unit/modules/network/contentType.test.ts`

**Interfaces:**

- Consumes: 无（叶子任务）
- Produces:
  - `DEFAULT_SESSION_NAME: 'default'`、`DEFAULT_SESSION_KEEP: number = 5000`、`TRIM_EVERY_INGESTS: number = 200`、`LIST_DEFAULT_LIMIT: number = 500`、`LIST_MAX_LIMIT: number = 2000`
  - `MAX_CAPTURED_BODY_BYTES: number = 1048576`、`CDP_BODY_TIMEOUT_MS: number = 3000`、`CDP_BODY_CAPTURE_ENABLED: boolean = true`
  - `TEXTUAL_CONTENT_TYPES: string[]`、`isTextualContentType(contentType: string): boolean`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/network/contentType.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  isTextualContentType,
  TEXTUAL_CONTENT_TYPES,
} from '../../../../src/modules/network/contentType.js';

describe('isTextualContentType', () => {
  it('accepts the documented whitelist tokens', () => {
    assert.strictEqual(isTextualContentType('application/json'), true);
    assert.strictEqual(isTextualContentType('text/html; charset=utf-8'), true);
    assert.strictEqual(isTextualContentType('application/javascript'), true);
    assert.strictEqual(isTextualContentType('text/event-stream'), true);
  });

  it('rejects binary payloads a blacklist would miss', () => {
    assert.strictEqual(isTextualContentType('application/wasm'), false);
    assert.strictEqual(isTextualContentType('application/x-font-woff'), false);
    assert.strictEqual(isTextualContentType('application/x-protobuf'), false);
    assert.strictEqual(isTextualContentType('application/octet-stream'), false);
    assert.strictEqual(isTextualContentType('image/png'), false);
    assert.strictEqual(isTextualContentType(''), false);
  });

  it('keeps the whitelist tokens unchanged from NetworkModule', () => {
    assert.deepStrictEqual(TEXTUAL_CONTENT_TYPES, [
      'json',
      'text',
      'javascript',
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败，`Cannot find module '.../src/modules/network/contentType.js'`（实现还不存在）。

- [ ] **Step 3: 实现三个新文件**

`src/modules/network/contentType.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 文本 MIME 片段白名单。原样来自 src/modules/network/NetworkModule.ts，
 * 提取为单一来源供 NetworkModule 与 CDP 抓包 adapter 共用（spec §5.1 / R9）。
 *
 * 刻意用白名单而非二进制黑名单：黑名单会漏 application/wasm、
 * application/x-font-woff、application/x-protobuf 等。
 */
export const TEXTUAL_CONTENT_TYPES = ['json', 'text', 'javascript'];

export function isTextualContentType(contentType: string): boolean {
  return TEXTUAL_CONTENT_TYPES.some(token => contentType.includes(token));
}
```

`src/modules/network/constants.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 传输层抓取常量（spec §9）。会话侧配额见 src/modules/session/constants.ts。
 */

/** 单条响应体入库上限（1 MiB）。与 MITM 侧原 MAX_BODY_SIZE 同值同源。 */
export const MAX_CAPTURED_BODY_BYTES = 1024 * 1024;

/**
 * CDP 响应体读取超时。与 CdpNetworkMonitor.RESPONSE_BODY_TIMEOUT_MS
 * 同值同语义：text() 挂起时按无 body 摄入，不得拖垮采集链路。
 */
export const CDP_BODY_TIMEOUT_MS = 3000;

/**
 * CDP 响应体主动抓取开关（spec §13-D3）。切片 2 的 SessionCaptureBridge 读取。
 * 注意：截断发生在取体之后，白名单（contentType.ts）才是有效的成本控制。
 */
export const CDP_BODY_CAPTURE_ENABLED = true;
```

`src/modules/session/constants.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 会话侧配额常量（spec §6 / §9）。传输层常量见 src/modules/network/constants.ts。
 */

/** 无活动会话时自动创建的默认会话名（spec §6）。 */
export const DEFAULT_SESSION_NAME = 'default';

/** 单会话保留请求行数上限，超出按 sequence 淘汰最旧（spec §9 / D4）。 */
export const DEFAULT_SESSION_KEEP = 5000;

/** 每成功落库多少次触发一次 trim，摊销删除成本（spec §9 / D4）。 */
export const TRIM_EVERY_INGESTS = 200;

/** 列表接口默认返回条数（spec §9）。 */
export const LIST_DEFAULT_LIMIT = 500;

/** 列表接口硬上限（spec §9）。 */
export const LIST_MAX_LIMIT = 2000;
```

- [ ] **Step 4: 迁移两处旧定义（值必须逐字不变）**

`src/modules/network/NetworkModule.ts`：删除 `:77` 的 `const TEXTUAL_CONTENT_TYPES = [...]` 与 `:99-101` 的 `function isTextualContentType(...)`，在相对导入区按字母序加入（与 `./NetworkTypes.js` 同组，排在其前）：

```ts
import {isTextualContentType} from './contentType.js';
```

`src/modules/proxy/MitmProxyServer.ts:23`：保留局部别名名，只换值来源（该文件其余 5 处引用不动）：

```ts
import {MAX_CAPTURED_BODY_BYTES} from '../network/constants.js';

// 与 Session 侧共享上限（spec §5.1 / §9）。保留局部名避免全文件改名。
const MAX_BODY_SIZE = MAX_CAPTURED_BODY_BYTES;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/network/contentType.test.js`
Expected: PASS。`NetworkModule` **没有**同名单测（`tests/unit/modules/network/` 目录不存在），迁移正确性由 `npm run typecheck` 与 Task 9 的全量 `npm run test:unit` 兜住。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 均通过。

- [ ] **Step 6: 提交**

```bash
git add src/modules/session/constants.ts src/modules/network/constants.ts src/modules/network/contentType.ts src/modules/network/NetworkModule.ts src/modules/proxy/MitmProxyServer.ts tests/unit/modules/network/contentType.test.ts
git commit -m "refactor(network): extract shared content-type and capture-size constants"
```

---

### Task 2: 共享 `withTimeout`（为 CDP 取体超时准备）

**Files:**

- Create: `src/utils/withTimeout.ts`
- Modify: `src/modules/collector/CdpNetworkMonitor.ts`（删除 `:241-264` 私有 `withTimeout`，改导入共享实现）
- Test: `tests/unit/utils/withTimeout.test.ts`

**Interfaces:**

- Consumes: 无
- Produces: `withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T>` —— 与 `CdpNetworkMonitor` 原私有实现**签名与语义完全一致**，Task 7 直接用。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/utils/withTimeout.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {withTimeout} from '../../../src/utils/withTimeout.js';

const delay = (ms: number): Promise<string> =>
  new Promise(resolve => setTimeout(() => resolve('late'), ms));

describe('withTimeout', () => {
  it('passes through a resolved value', async () => {
    assert.strictEqual(await withTimeout(Promise.resolve(7), 100, 'nope'), 7);
  });

  it('propagates the original rejection', async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error('inner')), 100, 'nope'),
      /inner/,
    );
  });

  it('rejects with the given message when the promise never settles', async () => {
    await assert.rejects(withTimeout(delay(50), 5, 'timed out'), /timed out/);
  });

  it('does not reject once the promise settles first', async () => {
    assert.strictEqual(await withTimeout(delay(5), 200, 'timed out'), 'late');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败，找不到 `src/utils/withTimeout.js`。

- [ ] **Step 3: 实现**

`src/utils/withTimeout.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 给 Promise 加超时保护：超时后以 `message` 拒绝。
 *
 * 仓库内曾有多份同语义私有实现（CdpNetworkMonitor / WorkerLifecycle /
 * BrowserTargetInspector / script.ts）。本切片只收敛 CDP 取体所需的一份，
 * 其余调用点签名/文案不同，属行为变更，按 spec §12 不在本切片处理。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
```

- [ ] **Step 4: 让 CdpNetworkMonitor 复用（去掉重复实现）**

在 `src/modules/collector/CdpNetworkMonitor.ts` 的相对导入区按字母序加入：

```ts
import {withTimeout} from '../../utils/withTimeout.js';
```

删除该文件 `:241-264` 的私有 `private async withTimeout<T>(...)`，并把 `:131` 的调用 `return this.withTimeout(` 改为 `return withTimeout(`（实参与返回值不变，超时文案不变）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/utils/withTimeout.test.js build/tests/unit/modules/collector/CdpNetworkMonitor.test.js`
Expected: 两个文件全 PASS（`CdpNetworkMonitor.test.ts` 是回归护栏：超时行为与消息未变）。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/utils/withTimeout.ts src/modules/collector/CdpNetworkMonitor.ts tests/unit/utils/withTimeout.test.ts
git commit -m "refactor(utils): extract shared withTimeout and reuse in CdpNetworkMonitor"
```

---

### Task 3: `CaptureSessionManager.ensureActiveSession()`

**Files:**

- Modify: `src/modules/session/CaptureSessionManager.ts`（在 `requireActiveSession()` 之后新增方法；`:6` 之后加常量导入）
- Test: `tests/unit/modules/session/CaptureSessionManager.test.ts`（扩展）

**Interfaces:**

- Consumes: `DEFAULT_SESSION_NAME`（Task 1）、既有 `createSession()` / `getActiveSession()`
- Produces: `ensureActiveSession(input?: {name?: string; targetUrl?: string}): SessionRow` —— 无活动会话时自动建一个（幂等）；`requireActiveSession()` **保持抛错语义不动**（三个 MCP 读工具仍依赖它）。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/modules/session/CaptureSessionManager.test.ts` 的 `describe` 内、`it('throws when no active session', ...)` **之后**插入：

```ts
it('ensures a default session on first call and reuses it', () => {
  const {manager, db} = makeManager();
  try {
    assert.strictEqual(manager.getActiveSession(), null);

    const first = manager.ensureActiveSession();
    assert.strictEqual(first.name, 'default');
    assert.strictEqual(first.status, 'capturing');
    assert.strictEqual(manager.listSessions().length, 1);

    const second = manager.ensureActiveSession();
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(
      manager.listSessions().length,
      1,
      'no duplicate session',
    );
  } finally {
    db.close();
  }
});

it('honours an explicit name on auto-create', () => {
  const {manager, db} = makeManager();
  try {
    const row = manager.ensureActiveSession({
      name: 'autocase',
      targetUrl: 'https://a.dev',
    });
    assert.strictEqual(row.name, 'autocase');
    assert.strictEqual(row.targetUrl, 'https://a.dev');
  } finally {
    db.close();
  }
});

it('recreates the session when the stored active row disappeared', () => {
  const {manager, db} = makeManager();
  try {
    const created = manager.createSession({name: 'demo'});
    assert.strictEqual(manager.ensureActiveSession().id, created.id);

    manager.transition(created.id, 'stopped');
    assert.strictEqual(
      manager.ensureActiveSession().id,
      created.id,
      'a stopped-but-present session is still reused',
    );
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败，`Property 'ensureActiveSession' does not exist on type 'CaptureSessionManager'`。

- [ ] **Step 3: 实现**

`src/modules/session/CaptureSessionManager.ts` —— 在 `import {randomUUID} from 'node:crypto';` 之后、既有相对导入组内按字母序加入：

```ts
import {DEFAULT_SESSION_NAME} from './constants.js';
```

在 `requireActiveSession()`（`:54-60`）之后插入：

```ts
  /**
   * 返回活动会话；没有就按默认名自动创建一个并激活（spec §6）。
   *
   * 与 requireActiveSession() 的区别只在缺省行为：本方法不抛错，
   * 供 CaptureEngine 的摄入路径使用；读工具仍用 require*，
   * 以免"查询"产生创建会话的副作用（spec §13-D7）。
   */
  ensureActiveSession(input: {name?: string; targetUrl?: string} = {}): SessionRow {
    const existing = this.getActiveSession();
    if (existing) {
      return existing;
    }
    return this.createSession({
      name: input.name ?? DEFAULT_SESSION_NAME,
      targetUrl: input.targetUrl,
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/session/CaptureSessionManager.test.js`
Expected: 全 PASS，含既有 `throws when no active session`（`requireActiveSession` 语义未变）。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 通过（prettier 会把 `ensureActiveSession` 签名折行）。

- [ ] **Step 5: 提交**

```bash
git add src/modules/session/CaptureSessionManager.ts tests/unit/modules/session/CaptureSessionManager.test.ts
git commit -m "feat(session): add ensureActiveSession for auto default session"
```

---

### Task 4: Store 读侧 —— `getRequest` / `listRequestSummaries` / `trimRequests`

**Files:**

- Create: `src/modules/session/summary.ts`
- Modify: `src/modules/session/types.ts`（新增 `CapturedRequestSummary`）
- Modify: `src/modules/session/SessionStore.ts:16-35`（接口新增 3 方法）
- Modify: `src/modules/session/SqliteSessionStore.ts`（实现 3 方法 + `RequestSummaryDbRow`）
- Test: `tests/unit/modules/session/SqliteSessionStore.test.ts`（扩展）

**Interfaces:**

- Consumes: `LIST_DEFAULT_LIMIT` / `LIST_MAX_LIMIT`（Task 1）、既有 `RequestFilter`（`types.ts:104-107`）
- Produces:
  - `CapturedRequestSummary`（11 字段，无 body/无 headers）
  - `toSummary(row: SummarySource): CapturedRequestSummary`，其中 `SummarySource = Pick<CapturedRequestRow, 摘要的 11 个列>`——整行 `CapturedRequestRow` 可直接传入（结构化类型），Store 侧只传摘要列、不必伪造 body 字段
  - `SessionStore.getRequest(id: string): CapturedRequestRow | null`
  - `SessionStore.listRequestSummaries(sessionId: string, filter?: RequestFilter, page?: {limit?: number; offset?: number}): CapturedRequestSummary[]`
  - `SessionStore.trimRequests(sessionId: string, keepLast: number): number`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/modules/session/SqliteSessionStore.test.ts` 的 `describe` 末尾追加（沿用文件已有的 `makeStore()` 与 `CapturedRequestRow` 导入）：

```ts
it('reads a single request by id', () => {
  const {store, manager} = makeStore();
  try {
    store.createSession({id: 's1', name: 'demo'});
    store.appendRequest(makeRequestRow('s1-1', 's1', 1, 'https://a.dev/one'));
    store.appendRequest(makeRequestRow('s1-2', 's1', 2, 'https://a.dev/two'));

    assert.strictEqual(store.getRequest('s1-2')?.url, 'https://a.dev/two');
    assert.strictEqual(store.getRequest('missing'), null);
  } finally {
    manager.close();
  }
});

it('lists summaries newest-first without body columns', () => {
  const {store, manager} = makeStore();
  try {
    store.createSession({id: 's1', name: 'demo'});
    for (let i = 1; i <= 5; i++) {
      store.appendRequest(
        makeRequestRow(`s1-${i}`, 's1', i, `https://a.dev/${i}`),
      );
    }

    const page = store.listRequestSummaries('s1', undefined, {
      limit: 3,
      offset: 1,
    });
    assert.deepStrictEqual(
      page.map(r => r.sequence),
      [4, 3, 2],
      'ORDER BY sequence DESC + LIMIT/OFFSET',
    );
    assert.strictEqual('requestBody' in (page[0] as object), false);
    assert.strictEqual('responseBody' in (page[0] as object), false);
    assert.strictEqual('requestHeaders' in (page[0] as object), false);
    assert.strictEqual('responseHeaders' in (page[0] as object), false);
    assert.strictEqual(page[0]?.truncated, 1, 'flag preserved as 0/1 number');

    const filtered = store.listRequestSummaries('s1', {
      sources: ['proxy'],
      urlFilter: 'DEV/3',
    });
    assert.deepStrictEqual(
      filtered.map(r => r.url),
      ['https://a.dev/3'],
      'sources + case-insensitive urlFilter',
    );

    const other = store.listRequestSummaries('other-session');
    assert.deepStrictEqual(other, []);
  } finally {
    manager.close();
  }
});

it('trims to the newest keepLast rows and is a no-op below quota', () => {
  const {store, manager} = makeStore();
  try {
    store.createSession({id: 's1', name: 'demo'});
    for (let i = 1; i <= 7; i++) {
      store.appendRequest(
        makeRequestRow(`s1-${i}`, 's1', i, `https://a.dev/${i}`),
      );
    }

    assert.strictEqual(store.trimRequests('s1', 5), 2, 'deleted two oldest');
    assert.deepStrictEqual(
      store.getRequests('s1').map(r => r.sequence),
      [3, 4, 5, 6, 7],
    );

    assert.strictEqual(store.trimRequests('s1', 5), 0, 'below quota: no-op');
    assert.strictEqual(store.trimRequests('s1', 1), 4);
    assert.deepStrictEqual(
      store.getRequests('s1').map(r => r.sequence),
      [7],
      'keepLast=1 keeps only the newest',
    );
  } finally {
    manager.close();
  }
});
```

在文件顶部 `describe` 之前追加共享构造器（替换现有用例里内联的字面量不是本任务目标，新用例统一用它）：

```ts
function makeRequestRow(
  id: string,
  sessionId: string,
  sequence: number,
  url: string,
): CapturedRequestRow {
  return {
    id,
    sessionId,
    sequence,
    timestamp: 100 + sequence,
    method: 'GET',
    url,
    source: 'proxy',
    requestHeaders: '{}',
    requestBody: 'x'.repeat(2048),
    statusCode: 200,
    responseHeaders: '{}',
    responseBody: 'y'.repeat(2048),
    contentType: 'application/json',
    initiator: null,
    durationMs: 0,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 1,
  };
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败（`getRequest` / `listRequestSummaries` / `trimRequests` 不存在）。

- [ ] **Step 3: 加类型与投影函数**

`src/modules/session/types.ts` —— 在 `CapturedRequestInput`（`:79-82`）之后插入：

```ts
/**
 * 列表/推送用的摘要投影：刻意排除 requestHeaders / requestBody /
 * responseHeaders / responseBody，避免整行出网（spec §8 / §9 / R2）。
 */
export interface CapturedRequestSummary {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  source: CaptureSource;
  truncated: number;
  isStreaming: number;
}
```

新建 `src/modules/session/summary.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CapturedRequestRow, CapturedRequestSummary} from './types.js';

/** 投影所需的最小列集：整行（引擎侧）和显式摘要行（Store 侧）都能直接传入。 */
export type SummarySource = Pick<
  CapturedRequestRow,
  | 'id'
  | 'sessionId'
  | 'sequence'
  | 'timestamp'
  | 'method'
  | 'url'
  | 'statusCode'
  | 'contentType'
  | 'source'
  | 'truncated'
  | 'isStreaming'
>;

/**
 * → 摘要。字段顺序即 WS payload 与 REST 列表项的契约（spec §8）。
 * 刻意只吃 SummarySource：Store 侧不必为投影伪造 body/headers 字段。
 */
export function toSummary(row: SummarySource): CapturedRequestSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    timestamp: row.timestamp,
    method: row.method,
    url: row.url,
    statusCode: row.statusCode,
    contentType: row.contentType,
    source: row.source,
    truncated: row.truncated,
    isStreaming: row.isStreaming,
  };
}
```

- [ ] **Step 4: 扩接口与实现**

`src/modules/session/SessionStore.ts` —— 在 `getRequests(...)` 之后插入：

```ts
  getRequest(id: string): CapturedRequestRow | null;
  listRequestSummaries(
    sessionId: string,
    filter?: RequestFilter,
    page?: {limit?: number; offset?: number},
  ): CapturedRequestSummary[];
  /** 按 sequence 淘汰最旧行，只保留最新 keepLast 条；返回删除行数。 */
  trimRequests(sessionId: string, keepLast: number): number;
```

并在该文件 `import type {...} from './types.js'` 清单里加 `CapturedRequestSummary`。

`src/modules/session/SqliteSessionStore.ts` —— 在 `RequestDbRow`（`:31-50`）之后加摘要行的形状（用 `type` 而非空 `interface`，`no-empty-interface` 会报）：

```ts
/** listRequestSummaries 的显式列投影结果：类型上刻意不含 body/headers，SELECT 也拿不到。 */
type RequestSummaryDbRow = Pick<
  RequestDbRow,
  | 'id'
  | 'session_id'
  | 'sequence'
  | 'timestamp'
  | 'method'
  | 'url'
  | 'source'
  | 'status_code'
  | 'content_type'
  | 'truncated'
  | 'is_streaming'
>;
```

在类内 `getRequests(...)`（`:254-276`）之后加三个方法：

```ts
  getRequest(id: string): CapturedRequestRow | null {
    const row = this.db
      .prepare(`SELECT * FROM captured_requests WHERE id = ?`)
      .get(id) as RequestDbRow | undefined;
    return row ? toRequest(row) : null;
  }

  listRequestSummaries(
    sessionId: string,
    filter: RequestFilter = {},
    page: {limit?: number; offset?: number} = {},
  ): CapturedRequestSummary[] {
    const clauses: string[] = [`session_id = ?`];
    const params: unknown[] = [sessionId];

    if (filter.sources && filter.sources.length > 0) {
      const placeholders = filter.sources.map(() => '?').join(', ');
      clauses.push(`source IN (${placeholders})`);
      params.push(...filter.sources);
    }
    if (filter.urlFilter) {
      // 与 getRequests（:265-268）完全同款匹配语义，避免两条读路径行为分叉。
      clauses.push('lower(url) LIKE ?');
      params.push(`%${filter.urlFilter.toLowerCase()}%`);
    }

    const limit = Math.min(
      Math.max(page.limit ?? LIST_DEFAULT_LIMIT, 1),
      LIST_MAX_LIMIT,
    );
    const offset = Math.max(page.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `SELECT id, session_id, sequence, timestamp, method, url, source,
                status_code, content_type, truncated, is_streaming
         FROM captured_requests
         WHERE ${clauses.join(' AND ')}
         ORDER BY sequence DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as RequestSummaryDbRow[];

    return rows.map(r =>
      toSummary({
        id: r.id,
        sessionId: r.session_id,
        sequence: r.sequence,
        timestamp: r.timestamp,
        method: r.method,
        url: r.url,
        statusCode: r.status_code,
        contentType: r.content_type,
        source: r.source,
        truncated: r.truncated,
        isStreaming: r.is_streaming,
      }),
    );
  }

  trimRequests(sessionId: string, keepLast: number): number {
    const info = this.db
      .prepare(
        `DELETE FROM captured_requests
         WHERE session_id = ?
           AND sequence <= (
             SELECT sequence FROM captured_requests
             WHERE session_id = ?
             ORDER BY sequence DESC
             LIMIT 1 OFFSET ?
           )`,
      )
      .run(sessionId, sessionId, keepLast);
    return info.changes;
  }
```

并在该文件导入区补：

```ts
import {LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT} from './constants.js';
import {toSummary} from './summary.js';
```

以及在 `import type {...} from './types.js'` 清单里加 `CapturedRequestSummary`。

> `trimRequests` 的 `OFFSET keepLast` 取的是"第 keepLast+1 新"的行，`sequence <= ` 它即删掉所有更旧的；行数不足 keepLast+1 时子查询为 `NULL`，`DELETE` 匹配 0 行 → 天然空操作。边界在 Step 1 的用例里已固定，改动 SQL 必须保持这两个结论。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/session/SqliteSessionStore.test.js`
Expected: 全 PASS（含既有用例）。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/modules/session/summary.ts src/modules/session/types.ts src/modules/session/SessionStore.ts src/modules/session/SqliteSessionStore.ts tests/unit/modules/session/SqliteSessionStore.test.ts
git commit -m "feat(session): add summary projection, single-row read and quota trim to store"
```

---

### Task 5: `CaptureEngine` —— 晚绑定、摘要推送、错误隔离、配额 trim

**Files:**

- Modify: `src/modules/session/CaptureEngine.ts`（整文件重写，见 Step 3）
- Modify: `src/modules/session/index.ts`（barrel 补 `toSummary` 与常量）
- Test: `tests/unit/modules/session/CaptureEngine.test.ts`（**含既有断言反转**，Step 1）

**Interfaces:**

- Consumes: `ensureActiveSession()`（Task 3）、`trimRequests()`（Task 4）、`toSummary()`（Task 4）、`DEFAULT_SESSION_KEEP` / `TRIM_EVERY_INGESTS`（Task 1）
- Produces:
  - `new CaptureEngine(manager, store, opts?: {emitToWs?: (e: {type: string; payload: unknown}) => void; keepLast?: number; trimEveryIngests?: number})`
  - `setEmitToWs(fn?: (e: {type: string; payload: unknown}) => void): void`
  - `ingestRequest(input): CapturedRequestRow | null`、`ingestHook(input): HookRecordRow | null`、`ingestSnapshot(input): StorageSnapshotRow | null`
  - `getFailureCount(): number`
  - WS payload 语义：`{type: 'session.request', payload: CapturedRequestSummary}`（**不再是整行**）

- [ ] **Step 1: 改写测试（先让它红）**

`tests/unit/modules/session/CaptureEngine.test.ts`：

1. `setup()`（`:19-32`）**已经**接受 opts 对象，只需放宽 opts 字段与 `store` 返回类型，以便注入假 store 与配额参数：

```ts
function setup(opts?: {
  emitToWs?: (event: {type: string; payload: unknown}) => void;
  store?: SessionStore;
  keepLast?: number;
  trimEveryIngests?: number;
}): {
  engine: CaptureEngine;
  manager: CaptureSessionManager;
  store: SessionStore;
  db: DatabaseManager;
} {
  const db = new DatabaseManager(':memory:');
  const store = opts?.store ?? new SqliteSessionStore(db);
  const manager = new CaptureSessionManager(store);
  const engine = new CaptureEngine(manager, store, opts);
  return {engine, manager, store, db};
}
```

并在导入区补 `SessionStore` 类型（`setup` 的 `store` 参数与返回类型要用；`constants` / `SessionRow` 的导入见下面第 5 条）：

```ts
import type {SessionStore} from '../../../../src/modules/session/SessionStore.js';
```

2. **删除**整块 `it('rejects ingress with "No active session" error when no active session', ...)`（`:130-184`）—— §6 后该行为已反转，替换为下面三个用例。
3. 把第一个用例末尾的事件断言（`:116-124`）**整块**替换为下面这段（`session.request` 的 payload 由整行改为摘要，`session.hook` / `session.snapshot` 仍推整行）：

```ts
assert.strictEqual(events.length, 4);
assert.strictEqual(events[0]?.type, 'session.request');
assert.deepStrictEqual(events[0]?.payload, {
  id: reqRow1.id,
  sessionId: reqRow1.sessionId,
  sequence: reqRow1.sequence,
  timestamp: reqRow1.timestamp,
  method: reqRow1.method,
  url: reqRow1.url,
  statusCode: reqRow1.statusCode,
  contentType: reqRow1.contentType,
  source: reqRow1.source,
  truncated: reqRow1.truncated,
  isStreaming: reqRow1.isStreaming,
});
assert.strictEqual(
  'responseBody' in (events[0]?.payload as object),
  false,
  'WS payload 必须是摘要，不得含 body（spec §8 / R1）',
);
assert.strictEqual(
  'initiator' in (events[0]?.payload as object),
  false,
  '摘要不含 initiator / durationMs（v2 的 source_ref 才恢复）',
);
assert.strictEqual(events[1]?.type, 'session.request');
assert.strictEqual(
  (events[1]?.payload as {sequence: number}).sequence,
  reqRow2.sequence,
);
assert.strictEqual(events[2]?.type, 'session.hook');
assert.deepStrictEqual(events[2]?.payload, hookRow);
assert.strictEqual(events[3]?.type, 'session.snapshot');
assert.deepStrictEqual(events[3]?.payload, snapRow);
```

4. 追加三个新用例：

```ts
it('auto-creates the default session on the first ingest', () => {
  const {engine, manager, db} = setup();
  try {
    assert.strictEqual(manager.getActiveSession(), null);
    const row = engine.ingestRequest(defaultRequestInput);
    const session = manager.getActiveSession();
    assert.ok(row);
    assert.ok(session);
    assert.strictEqual(session.name, 'default');
    assert.strictEqual(row?.sessionId, session.id);
    assert.strictEqual(row?.sequence, 1);
  } finally {
    db.close();
  }
});

it('isolates store failures from the producer and counts them', () => {
  const failing = makeFakeStore({
    appendRequest: () => {
      throw new Error('SQLITE_BUSY');
    },
  });
  const {engine, db} = setup({store: failing});
  try {
    assert.strictEqual(engine.ingestRequest(defaultRequestInput), null);
    assert.strictEqual(engine.getFailureCount(), 1);
    assert.strictEqual(engine.ingestRequest(defaultRequestInput), null);
    assert.strictEqual(engine.getFailureCount(), 2);
  } finally {
    db.close();
  }
});

it('trims to the quota every trimEveryIngests successful appends', () => {
  let trimmed: number | null = null;
  const tracking = makeFakeStore({
    trimRequests: (_sessionId, keepLast) => {
      trimmed = keepLast;
      return 0;
    },
  });
  const {engine, db} = setup({
    store: tracking,
    keepLast: 1234,
    trimEveryIngests: 2,
  });
  try {
    engine.ingestRequest(defaultRequestInput);
    assert.strictEqual(trimmed, null, 'first ingest below the interval');
    engine.ingestRequest(defaultRequestInput);
    assert.strictEqual(trimmed, 1234, 'second ingest crosses the interval');
    assert.strictEqual(TRIM_EVERY_INGESTS, 200, 'production default');
  } finally {
    db.close();
  }
});
```

5. 在 `describe` 之前加共享 fixture（**命名 `defaultRequestInput`**，避免与被删用例内的局部 `requestInput` 及用例 1 的局部同名变量混淆）：

````ts
const defaultRequestInput: CapturedRequestInput = {
  timestamp: 1700000000000,
  method: 'POST',
  url: 'https://example.com/api/data',
  source: 'cdp',
  requestHeaders: '{"Content-Type":"application/json"}',
  requestBody: '{"q":1}',
  statusCode: 200,
  responseHeaders: '{"Content-Type":"application/json"}',
  responseBody: '{"ok":true}',
  contentType: 'application/json',
  initiator: null,
  durationMs: 0,
  isStreaming: 0,
  isWebSocket: 0,
  truncated: 0,
};

> `createSession` / `getSession` 必须返回可用会话行——`ensureActiveSession()` 会经 `manager.createSession()` 走它们；其余方法给最小桩。

```ts
function makeFakeStore(overrides: Partial<SessionStore> = {}): SessionStore {
  const session: SessionRow = {
    id: 'fake-session',
    name: DEFAULT_SESSION_NAME,
    targetUrl: null,
    status: 'capturing',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    meta: null,
  };
  return {
    createSession: () => session,
    updateSessionStatus: () => undefined,
    getSession: id => (id === session.id ? session : null),
    listSessions: () => [session],
    appendRequest: () => undefined,
    appendHook: () => undefined,
    appendSnapshot: () => undefined,
    getRequests: () => [],
    getRequest: () => null,
    listRequestSummaries: () => [],
    trimRequests: () => 0,
    getHooks: () => [],
    getSnapshots: () => [],
    saveReport: () => undefined,
    getReport: () => null,
    getReports: () => [],
    close: () => undefined,
    ...overrides,
  };
}
````

导入区相应补两行（放在既有相对导入组内，按字母序）：

```ts
import {
  DEFAULT_SESSION_NAME,
  TRIM_EVERY_INGESTS,
} from '../../../../src/modules/session/constants.js';
import type {
  CapturedRequestInput,
  SessionRow,
} from '../../../../src/modules/session/types.js';
```

> 用 `makeFakeStore` 而非真 SQLite，是为了让"落库抛错"与"trim 次数"可直接断言；真实的 `:memory:` 路径仍由前三个用例覆盖，两条路径不重叠。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败（`setEmitToWs` / `getFailureCount` / `keepLast` 选项不存在、返回类型不匹配）。

- [ ] **Step 3: 重写实现**

`src/modules/session/CaptureEngine.ts` 全文替换为：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {logger} from '../../utils/logger.js';

import type {CaptureSessionManager} from './CaptureSessionManager.js';
import {DEFAULT_SESSION_KEEP, TRIM_EVERY_INGESTS} from './constants.js';
import type {SessionStore} from './SessionStore.js';
import {toSummary} from './summary.js';
import type {
  CapturedRequestInput,
  CapturedRequestRow,
  HookRecordInput,
  HookRecordRow,
  StorageSnapshotInput,
  StorageSnapshotRow,
} from './types.js';

export interface CaptureEngineOptions {
  emitToWs?: (event: {type: string; payload: unknown}) => void;
  /** 会话保留配额，默认 DEFAULT_SESSION_KEEP（spec §9 / D4）。 */
  keepLast?: number;
  /** 每多少次成功落库触发一次 trim，默认 TRIM_EVERY_INGESTS。 */
  trimEveryIngests?: number;
}

/**
 * CaptureEngine —— CDP 与 MITM 两条链路的唯一聚合点（spec §3）。
 *
 * 契约：
 * 1. 摄入**绝不向生产者抛错**。落库失败只 warn + 计数，返回 null，
 *    避免异常冒泡进 Playwright / MITM 的事件回调（spec §4 / R3）。
 * 2. WS 只推摘要（`toSummary`），body 的唯一出口是 REST 详情（spec §8 / R1）。
 * 3. 配额由本类（唯一写入方）按 ingest 计数摊销维护（spec §9 / D4）。
 */
export class CaptureEngine {
  private emitToWs?: (event: {type: string; payload: unknown}) => void;
  private readonly keepLast: number;
  private readonly trimEveryIngests: number;
  private ingestsSinceTrim = 0;
  private failureCount = 0;

  constructor(
    private readonly manager: CaptureSessionManager,
    private readonly store: SessionStore,
    opts: CaptureEngineOptions = {},
  ) {
    this.emitToWs = opts.emitToWs;
    this.keepLast = opts.keepLast ?? DEFAULT_SESSION_KEEP;
    this.trimEveryIngests = opts.trimEveryIngests ?? TRIM_EVERY_INGESTS;
  }

  /**
   * 晚绑定 WS 桥接：Runtime 在 ConsoleServer 之前建立，
   * 回调只能在 server.start() 时注入（spec §8）。可传 undefined 解绑。
   */
  setEmitToWs(
    emitToWs?: (event: {type: string; payload: unknown}) => void,
  ): void {
    this.emitToWs = emitToWs;
  }

  /** 摄入失败累计次数（落库异常被隔离的次数）。 */
  getFailureCount(): number {
    return this.failureCount;
  }

  ingestRequest(input: CapturedRequestInput): CapturedRequestRow | null {
    let row: CapturedRequestRow;
    try {
      const session = this.manager.ensureActiveSession();
      const sequence = this.manager.nextSequence(session.id);
      row = {
        id: `${session.id}-${sequence}`,
        sessionId: session.id,
        sequence,
        ...input,
      };
      this.store.appendRequest(row);
      this.trackTrim(session.id);
    } catch (error) {
      this.failureCount += 1;
      logger.warn(
        `[CaptureEngine] 请求摄入落库失败，已丢弃第 ${this.failureCount} 条`,
        error,
      );
      return null;
    }
    this.emitToWs?.({type: 'session.request', payload: toSummary(row)});
    return row;
  }

  ingestHook(input: HookRecordInput): HookRecordRow | null {
    let row: HookRecordRow;
    try {
      const session = this.manager.ensureActiveSession();
      row = {sessionId: session.id, ...input};
      this.store.appendHook(row);
    } catch (error) {
      this.failureCount += 1;
      logger.warn('[CaptureEngine] Hook 摄入落库失败，已丢弃', error);
      return null;
    }
    this.emitToWs?.({type: 'session.hook', payload: row});
    return row;
  }

  ingestSnapshot(input: StorageSnapshotInput): StorageSnapshotRow | null {
    let row: StorageSnapshotRow;
    try {
      const session = this.manager.ensureActiveSession();
      row = {sessionId: session.id, ...input};
      this.store.appendSnapshot(row);
    } catch (error) {
      this.failureCount += 1;
      logger.warn('[CaptureEngine] 快照摄入落库失败，已丢弃', error);
      return null;
    }
    this.emitToWs?.({type: 'session.snapshot', payload: row});
    return row;
  }

  private trackTrim(sessionId: string): void {
    this.ingestsSinceTrim += 1;
    if (this.ingestsSinceTrim < this.trimEveryIngests) {
      return;
    }
    this.ingestsSinceTrim = 0;
    try {
      this.store.trimRequests(sessionId, this.keepLast);
    } catch (error) {
      // trim 失败只影响配额，不算摄入失败：行仍在库里，下次 ingest 再试。
      logger.warn('[CaptureEngine] trim 失败，本轮保留全部行', error);
    }
  }
}
```

> 两个语义要点必须保留：① 只有**落库成功**才推 WS（否则 UI 会出现点不进详情的幽灵行）；② `session.hook` / `session.snapshot` 频道本切片仍未注册，是否转发由消费侧白名单决定（spec §8），引擎不做静默吞掉。

`src/modules/session/index.ts` —— 在 `:10` 之后补：

```ts
export {toSummary} from './summary.js';
export * from './constants.js';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/session/CaptureEngine.test.js build/tests/integration/session/session-ai-pipeline.integration.test.js`
Expected: 全 PASS。若集成测试报 `CapturedRequestRow | null` 相关错，按其断言补 `assert.ok(row)` 后继续（该文件只用返回值取 `sessionId`）。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/modules/session/CaptureEngine.ts src/modules/session/index.ts tests/unit/modules/session/CaptureEngine.test.ts
git commit -m "feat(session): harden CaptureEngine with late-bound ws, summary payload, error isolation and quota trim"
```

---

### Task 6: `MitmRequestAdapter`（`CapturedExchange → CapturedRequestInput`）

**Files:**

- Create: `src/modules/session/adapters/MitmRequestAdapter.ts`
  （`adapters/index.ts` barrel 留到 Task 7 一起建——它同时引用 CDP adapter，先建会让构建变红）
- Test: `tests/unit/modules/session/adapters/MitmRequestAdapter.test.ts`

**Interfaces:**

- Consumes: `CapturedExchange`（`src/modules/proxy/types.ts:8-24`）、`CapturedRequestInput`（`src/modules/session/types.ts:79-82`）
- Produces: `toCapturedRequestInput(exchange: CapturedExchange): CapturedRequestInput`（纯函数、同步、不抛）

- [ ] **Step 1: 写失败测试**

`tests/unit/modules/session/adapters/MitmRequestAdapter.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {CapturedExchange} from '../../../../../src/modules/proxy/types.js';
import {toCapturedRequestInput} from '../../../../../src/modules/session/adapters/MitmRequestAdapter.js';

function makeExchange(
  overrides: Partial<CapturedExchange> = {},
): CapturedExchange {
  return {
    requestId: 'req-1',
    method: 'POST',
    url: 'https://a.dev/sign',
    requestHeaders: {'content-type': 'application/json'},
    requestBody: '{"q":1}',
    statusCode: 200,
    responseHeaders: {'content-type': 'application/json'},
    responseBody: '{"ok":true}',
    contentType: 'application/json',
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: 1700000000000,
    ...overrides,
  };
}

describe('MitmRequestAdapter', () => {
  it('maps headers to JSON strings and flags to 0/1', () => {
    const input = toCapturedRequestInput(makeExchange());
    assert.strictEqual(input.source, 'proxy');
    assert.strictEqual(
      input.requestHeaders,
      '{"content-type":"application/json"}',
    );
    assert.strictEqual(
      input.responseHeaders,
      '{"content-type":"application/json"}',
    );
    assert.strictEqual(input.isStreaming, 0);
    assert.strictEqual(input.isWebSocket, 0);
    assert.strictEqual(input.truncated, 0);
  });

  it('carries through true flags and the exchange timestamp', () => {
    const input = toCapturedRequestInput(
      makeExchange({
        isStreaming: true,
        isWebSocket: true,
        truncated: true,
        timestamp: 42,
      }),
    );
    assert.strictEqual(input.isStreaming, 1);
    assert.strictEqual(input.isWebSocket, 1);
    assert.strictEqual(input.truncated, 1);
    assert.strictEqual(input.timestamp, 42);
  });

  it('nulls the columns MITM cannot supply', () => {
    const input = toCapturedRequestInput(
      makeExchange({requestBody: null, responseBody: null, contentType: null}),
    );
    assert.strictEqual(input.requestBody, null);
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.contentType, null);
    assert.strictEqual(input.initiator, null);
    assert.strictEqual(input.durationMs, 0);
  });

  it('degrades malformed header records to an empty JSON object', () => {
    const input = toCapturedRequestInput(
      makeExchange({
        requestHeaders: undefined as unknown as Record<string, string>,
      }),
    );
    assert.strictEqual(input.requestHeaders, '{}');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败，找不到 `adapters/MitmRequestAdapter.js`。

- [ ] **Step 3: 实现**

`src/modules/session/adapters/MitmRequestAdapter.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CapturedExchange} from '../../proxy/types.js';
import type {CapturedRequestInput} from '../types.js';

const toFlag = (value: boolean): number => (value ? 1 : 0);

// MITM 的 responseHeaders 类型上非空，但运行时可能为 undefined（历史数据 / 手工构造）。
const stringifyHeaders = (
  headers: Record<string, string> | undefined,
): string => JSON.stringify(headers ?? {});

/**
 * MITM 链路字段映射（spec §5）。纯函数、不抛错。
 *
 * 刻意丢弃的列：isOptions / isStatic（row 无对应列，噪声标记改由前端按
 * contentType 推导，见 §10）、requestId（跨源关联键，v2 的 source_ref 才恢复，
 * 见 §12）。durationMs 与 initiator 在 MITM 侧取不到，固定 0 / null。
 */
export function toCapturedRequestInput(
  exchange: CapturedExchange,
): CapturedRequestInput {
  return {
    timestamp: exchange.timestamp,
    method: exchange.method,
    url: exchange.url,
    source: 'proxy',
    requestHeaders: stringifyHeaders(exchange.requestHeaders),
    requestBody: exchange.requestBody,
    statusCode: exchange.statusCode,
    responseHeaders: stringifyHeaders(exchange.responseHeaders),
    responseBody: exchange.responseBody,
    contentType: exchange.contentType,
    initiator: null,
    durationMs: 0,
    isStreaming: toFlag(exchange.isStreaming),
    isWebSocket: toFlag(exchange.isWebSocket),
    truncated: toFlag(exchange.truncated),
  };
}
```

`src/modules/session/adapters/index.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 两条抓包链路 → CapturedRequestInput 的纯映射（spec §5）。
export {toCapturedRequestInput as fromMitmExchange} from './MitmRequestAdapter.js';
export {cdpResponseToInput as fromCdpResponse} from './CdpRequestAdapter.js';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/session/adapters/MitmRequestAdapter.test.js`
Expected: PASS。`adapters/index.ts` 引用的 `CdpRequestAdapter` 在 Task 7 落地，因此**本步骤临时不创建 `index.ts`**，把上面 barrel 文件留到 Task 7 Step 3 一起建（避免红构建）。

- [ ] **Step 5: 提交**

```bash
git add src/modules/session/adapters/MitmRequestAdapter.ts tests/unit/modules/session/adapters/MitmRequestAdapter.test.ts
git commit -m "feat(session): add MITM capture field adapter"
```

---

### Task 7: `CdpRequestAdapter`（`Playwright.Response → CapturedRequestInput`）

**Files:**

- Create: `src/modules/session/adapters/CdpRequestAdapter.ts`
- Create: `src/modules/session/adapters/index.ts`（Task 6 暂 deferred 的 barrel，此时两个实现都在）
- Test: `tests/unit/modules/session/adapters/CdpRequestAdapter.test.ts`

**Interfaces:**

- Consumes: `isTextualContentType()`（Task 1）、`withTimeout()`（Task 2）、`MAX_CAPTURED_BODY_BYTES` / `CDP_BODY_TIMEOUT_MS`（Task 1）、`patchright` 的 `Response` 类型
- Produces:
  - `type CdpBodyReader = (response: Response) => Promise<string | null>`
  - `cdpResponseToInput(response: Response, opts?: {readBody?: CdpBodyReader; now?: () => number}): Promise<CapturedRequestInput>`
  - `readCdpResponseBody(response: Response): Promise<string | null>`（默认取体器：超时 + catch，只 warn）

- [ ] **Step 1: 写失败测试**

`tests/unit/modules/session/adapters/CdpRequestAdapter.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Response} from 'patchright';

import {MAX_CAPTURED_BODY_BYTES} from '../../../../../src/modules/network/constants.js';
import {cdpResponseToInput} from '../../../../../src/modules/session/adapters/CdpRequestAdapter.js';

interface FakeResponseOptions {
  contentType?: string | null;
  body?: string | null;
  postData?: string | null;
}

function makeResponse(opts: FakeResponseOptions): Response {
  const headers: Record<string, string> = {};
  if (opts.contentType) {
    headers['content-type'] = opts.contentType;
  }
  const request = {
    method: () => 'POST',
    url: () => 'https://a.dev/sign',
    headers: () => ({cookie: 'x=1'}),
    postData: () => opts.postData ?? '{"q":1}',
  };
  return {
    status: () => 204,
    headers: () => headers,
    request: () => request,
    text: async () => opts.body ?? '',
  } as unknown as Response;
}

describe('cdpResponseToInput', () => {
  it('maps request fields and pins source to cdp', async () => {
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'application/json', body: '{"ok":true}'}),
      {readBody: async () => '{"ok":true}'},
    );
    assert.strictEqual(input.source, 'cdp');
    assert.strictEqual(input.method, 'POST');
    assert.strictEqual(input.url, 'https://a.dev/sign');
    assert.strictEqual(input.statusCode, 204);
    assert.strictEqual(input.requestBody, '{"q":1}');
    assert.strictEqual(input.responseBody, '{"ok":true}');
    assert.strictEqual(input.contentType, 'application/json');
    assert.strictEqual(input.requestHeaders, '{"cookie":"x=1"}');
    assert.strictEqual(
      input.responseHeaders,
      '{"content-type":"application/json"}',
    );
    assert.strictEqual(input.initiator, null);
    assert.strictEqual(input.durationMs, 0);
    assert.strictEqual(input.isWebSocket, 0);
  });

  it('reads the timestamp before awaiting the body (spec §5 / r2.1)', async () => {
    const order: string[] = [];
    await cdpResponseToInput(makeResponse({contentType: 'application/json'}), {
      now: () => {
        order.push('now');
        return 123;
      },
      readBody: async () => {
        order.push('readBody');
        return 'b';
      },
    });
    assert.deepStrictEqual(order, ['now', 'readBody']);
  });

  it('skips the body for non-whitelisted content types', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'image/png'}),
      {
        readBody: async () => {
          called += 1;
          return 'never';
        },
      },
    );
    assert.strictEqual(called, 0);
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.truncated, 0);
  });

  it('marks SSE as streaming without reading the body', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'text/event-stream'}),
      {
        readBody: async () => {
          called += 1;
          return 'never';
        },
      },
    );
    assert.strictEqual(called, 0, 'SSE 取体会挂起');
    assert.strictEqual(input.isStreaming, 1);
    assert.strictEqual(input.responseBody, null);
  });

  it('truncates an oversized body and flags it', async () => {
    const big = 'a'.repeat(MAX_CAPTURED_BODY_BYTES + 10);
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'text/plain'}),
      {readBody: async () => big},
    );
    assert.strictEqual(input.truncated, 1);
    assert.strictEqual(
      (input.responseBody as string).length,
      MAX_CAPTURED_BODY_BYTES,
    );
  });

  it('degrades a null body read without throwing', async () => {
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'application/json'}),
      {readBody: async () => null},
    );
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.truncated, 0);
  });

  it('survives a request whose headers/postData accessors throw', async () => {
    const broken = {
      status: () => 500,
      headers: () => ({}),
      request: () => ({
        method: () => 'GET',
        url: () => 'https://a.dev/x',
        headers: () => {
          throw new Error('disposed');
        },
        postData: () => {
          throw new Error('disposed');
        },
      }),
    } as unknown as Response;
    const input = await cdpResponseToInput(broken, {
      readBody: async () => null,
    });
    assert.strictEqual(input.requestHeaders, '{}');
    assert.strictEqual(input.requestBody, null);
    assert.strictEqual(input.statusCode, 500);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建失败，找不到 `CdpRequestAdapter.js`。

- [ ] **Step 3: 实现 + 补 barrel**

`src/modules/session/adapters/CdpRequestAdapter.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {Response} from 'patchright';

import {
  CDP_BODY_TIMEOUT_MS,
  MAX_CAPTURED_BODY_BYTES,
} from '../../network/constants.js';
import {isTextualContentType} from '../../network/contentType.js';
import {logger} from '../../utils/logger.js';
import {withTimeout} from '../../utils/withTimeout.js';
import type {CapturedRequestInput} from '../types.js';

export type CdpBodyReader = (response: Response) => Promise<string | null>;

export interface CdpAdapterOptions {
  readBody?: CdpBodyReader;
  now?: () => number;
}

const safeJson = (value: Record<string, string> | undefined): string => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

/**
 * 默认取体器：带超时与兜底捕获。
 * text() 在资源被回收 / 导航被打断时会 reject，此处按“无 body”降级，不外抛。
 */
export async function readCdpResponseBody(
  response: Response,
): Promise<string | null> {
  try {
    return await withTimeout(
      response.text(),
      CDP_BODY_TIMEOUT_MS,
      `Timed out reading CDP response body for ${response.url()}`,
    );
  } catch (error) {
    logger.warn('[CaptureEngine][cdp] 响应体读取失败，按无 body 摄入', error);
    return null;
  }
}

/**
 * CDP 链路字段映射（spec §5 / §5.1）。
 *
 * 三条不变量：
 * 1. timestamp 必须在任何 await 之前取（响应头到达时刻），否则会把取体耗时
 *    算进时间戳（spec §5 / r2.1）。
 * 2. 只有文本白名单 contentType 才取体；SSE 直接标 streaming 不读体。
 * 3. 本函数不抛错：请求对象已 dispose 时降级为空 headers / null body。
 *    落库失败由 CaptureEngine 统一隔离（spec §4 / R3）。
 */
export async function cdpResponseToInput(
  response: Response,
  opts: CdpAdapterOptions = {},
): Promise<CapturedRequestInput> {
  const readBody = opts.readBody ?? readCdpResponseBody;
  const now = opts.now ?? Date.now;
  const timestamp = now();

  const request = response.request();
  const contentType = response.headers()['content-type'] ?? null;
  const isStreaming = Boolean(contentType?.includes('text/event-stream'));

  let responseBody: string | null = null;
  let truncated = 0;
  if (!isStreaming && contentType && isTextualContentType(contentType)) {
    const raw = await readBody(response);
    if (raw !== null) {
      // 截断是取体之后的事：白名单才是成本控制，1MiB 只是入库上限（spec §5.1）。
      truncated = raw.length > MAX_CAPTURED_BODY_BYTES ? 1 : 0;
      responseBody =
        truncated === 1 ? raw.slice(0, MAX_CAPTURED_BODY_BYTES) : raw;
    }
  }

  return {
    timestamp,
    method: request.method(),
    url: request.url(),
    source: 'cdp',
    requestHeaders: safeJson(tryGet(() => request.headers())),
    requestBody: tryGet(() => request.postData()) ?? null,
    statusCode: response.status(),
    responseHeaders: safeJson(tryGet(() => response.headers())),
    responseBody,
    contentType,
    initiator: null,
    durationMs: 0,
    isStreaming: isStreaming ? 1 : 0,
    isWebSocket: 0,
    truncated,
  };
}

function tryGet<T>(accessor: () => T): T | undefined {
  try {
    return accessor();
  } catch (error) {
    logger.warn('[CaptureEngine][cdp] 请求对象不可读，按缺省值摄入', error);
    return undefined;
  }
}
```

`src/modules/session/adapters/index.ts`（此时两个实现都已存在）：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 两条抓包链路 → CapturedRequestInput 的纯映射（spec §5）。
export {toCapturedRequestInput as fromMitmExchange} from './MitmRequestAdapter.js';
export {
  cdpResponseToInput as fromCdpResponse,
  readCdpResponseBody,
} from './CdpRequestAdapter.js';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/session/adapters/CdpRequestAdapter.test.js build/tests/unit/modules/session/adapters/MitmRequestAdapter.test.js`
Expected: 两个文件全 PASS（含默认 `readBody` 未被用到的路径）。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/modules/session/adapters/CdpRequestAdapter.ts src/modules/session/adapters/index.ts tests/unit/modules/session/adapters/CdpRequestAdapter.test.ts
git commit -m "feat(session): add CDP response adapter with whitelisted timed body capture"
```

---

### Task 8: Runtime 接线（共享 store + 可选访问器）

**Files:**

- Modify: `src/runtime/RuntimeServices.ts:41-48`（字段与构造）、`:82-86`（共享 store）、新增 `getCaptureEngine()`
- Modify: `src/runtime.ts:49-74`（接口新增可选字段）、`:135-137` 之后新增 getter
- Modify: `src/worker/ServiceLocator.ts`（新增 `getCaptureEngine()`）
- Test: `tests/unit/runtime/RuntimeServices.test.ts`（扩展）
- Create: `tests/unit/worker/ServiceLocator.test.ts`（该文件此前无测试）

**Interfaces:**

- Consumes: `CaptureEngine`（Task 5）、`SqliteSessionStore`（Task 4）、`ensureActiveSession()`（Task 3）
- Produces:
  - `new RuntimeServices(pageController, sessionDbPath?: string)` —— 第二个参数是**测试缝**，传 `':memory:'` 即不碰磁盘
  - `RuntimeServices.getCaptureEngine(): CaptureEngine`
  - `Runtime.captureEngine?: CaptureEngine`（可选，spec §7 / D6）
  - `ServiceLocator.getCaptureEngine(): CaptureEngine | undefined`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/runtime/RuntimeServices.test.ts` 的 `describe` 末尾追加：

```ts
it('creates the capture engine lazily and reuses it', () => {
  const services = new RuntimeServices({} as PageController, ':memory:');
  const engine = services.getCaptureEngine();
  assert.ok(engine);
  assert.strictEqual(services.getCaptureEngine(), engine);
});

it('shares one session store between manager and engine', () => {
  const services = new RuntimeServices({} as PageController, ':memory:');
  const engine = services.getCaptureEngine();
  const manager = services.getCaptureSessionManager();

  assert.strictEqual(manager.getActiveSession(), null);
  assert.ok(engine.ingestRequest(sampleInput));
  // 同库同连接：engine 写入的行，manager 立刻读得到（spec §7 约束 3）。
  const session = manager.getActiveSession();
  assert.ok(session);
  assert.strictEqual(session.name, 'default');
  assert.strictEqual(manager.getRequests(session.id).length, 1);
});

it('does not open the on-disk session db until a session service is requested', () => {
  const services = new RuntimeServices({} as PageController, ':memory:');
  assert.doesNotThrow(() => services.getWasmAnalyzer());
});
```

并在导入区补：

```ts
import type {CapturedRequestInput} from '../../../src/modules/session/types.js';
```

在文件末尾（`describe` 之外）加：

```ts
const sampleInput: CapturedRequestInput = {
  timestamp: 1700000000000,
  method: 'GET',
  url: 'https://example.com/api',
  source: 'cdp',
  requestHeaders: '{}',
  requestBody: null,
  statusCode: 200,
  responseHeaders: '{}',
  responseBody: null,
  contentType: 'application/json',
  initiator: null,
  durationMs: 0,
  isStreaming: 0,
  isWebSocket: 0,
  truncated: 0,
};
```

- [ ] **Step 1b: 补 `ServiceLocator.getCaptureEngine()` 的测试（该文件此前无测试）**

新建 `tests/unit/worker/ServiceLocator.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Runtime} from '../../../src/runtime.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {ServiceLocator} from '../../../src/worker/ServiceLocator.js';

describe('ServiceLocator.getCaptureEngine', () => {
  it('returns the runtime captureEngine when present', () => {
    const engine = {} as CaptureEngine;
    const runtime = {captureEngine: engine} as unknown as Runtime;
    assert.strictEqual(new ServiceLocator(runtime).getCaptureEngine(), engine);
  });

  it('returns undefined when the runtime mock lacks the service', () => {
    const locator = new ServiceLocator({} as unknown as Runtime);
    assert.strictEqual(locator.getCaptureEngine(), undefined);
  });

  it('returns undefined with no runtime at all', () => {
    assert.strictEqual(new ServiceLocator().getCaptureEngine(), undefined);
  });
});
```

> 三条用例锁的就是 spec §7 约束 1：可选访问器在 mock/缺省下必须安静返回 `undefined`，不许抛。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build`
Expected: 构建阶段即失败——`RuntimeServices` 无 `getCaptureEngine`、构造不接受第二个参数、`Runtime` 上无 `captureEngine` 字段、`ServiceLocator` 无 `getCaptureEngine`。符合 TDD 红灯预期。

- [ ] **Step 3: 实现 RuntimeServices**

字段区（`:41` 附近）改为：

```ts
  private captureSessionManager?: CaptureSessionManager;
  private captureEngine?: CaptureEngine;
  private sessionStore?: SqliteSessionStore;
```

构造函数（`:48`）改为（第二个参数是测试缝，生产端不传即走默认文件 DB）：

```ts
  constructor(
    private readonly pageController: PageController,
    private readonly sessionDbPath?: string,
  ) {}
```

导入区按字母序补：

```ts
import {CaptureEngine} from '../modules/session/CaptureEngine.js';
```

（`CaptureSessionManager` 与 `SqliteSessionStore` 已在该文件导入。）

把 `getCaptureSessionManager()`（`:82-86`）替换为：

```ts
  /**
   * 会话存储的唯一实例来源：manager 与 engine 必须共享同一个
   * DatabaseManager，否则两个 store 各开句柄、close() 互相踩（spec §7 约束 3）。
   */
  private ensureSessionStore(): SqliteSessionStore {
    return (this.sessionStore ??= new SqliteSessionStore(
      new DatabaseManager(this.sessionDbPath),
    ));
  }

  getCaptureSessionManager(): CaptureSessionManager {
    return (this.captureSessionManager ??= new CaptureSessionManager(
      this.ensureSessionStore(),
    ));
  }

  /** CDP + MITM 双链路的唯一聚合点（spec §3）。 */
  getCaptureEngine(): CaptureEngine {
    return (this.captureEngine ??= new CaptureEngine(
      this.getCaptureSessionManager(),
      this.ensureSessionStore(),
    ));
  }
```

- [ ] **Step 4: 实现 Runtime 可选访问器与 ServiceLocator 缝**

`src/runtime.ts` —— **不要**新增一条同路径 import（会触发 `import/no-duplicates`），把 `:21` 现有的类型导入扩成：

```ts
import type {
  CaptureEngine,
  CaptureSessionManager,
} from './modules/session/index.js';
```

在 `interface Runtime` 的 `captureSessionManager: CaptureSessionManager;`（`:62`）之后插入：

```ts
  /**
   * 可选：Cdp/MITM 统一聚合点（spec §7 / D6）。
   * 遵循 @stable 扩展约定——高扇入接口不新增强制字段，调用侧一律 `?.`。
   */
  captureEngine?: CaptureEngine;
```

在 `getRuntime()` 返回对象里、`get captureSessionManager()`（`:135-137`）之后插入：

```ts
    get captureEngine() {
      return services.getCaptureEngine();
    },
```

`src/worker/ServiceLocator.ts` —— 导入区补 `import type {CaptureEngine} from '../modules/session/index.js';`，并在 `getHookManager()` 之后插入：

```ts
  /**
   * 抓包聚合点的稳定访问缝：切片 2 的 SessionCaptureBridge 经此拿 engine，
   * 不直接持有 _runtime。缺省 undefined —— mock runtime 没有该服务时
   * 调用方必须能继续工作（spec §7 约束 1）。
   */
  getCaptureEngine(): CaptureEngine | undefined {
    return this._runtime?.captureEngine;
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/runtime/RuntimeServices.test.js build/tests/unit/web/ConsoleServer.test.js build/tests/unit/worker/ServiceLocator.test.js`
Expected: 全 PASS。`ConsoleServer.test.js` 是**关键回归**：它的 mock runtime 里没有 `captureEngine`，本切片未新增任何 `runtime.captureEngine` 调用，故必须照旧通过——一旦这条变红，说明有人在本切片里提前接了桥接（越界，回退）。

Run: `npm run typecheck && npx prettier --check <本 Task 改动文件列表> && npx eslint <同前>`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add src/runtime/RuntimeServices.ts src/runtime.ts src/worker/ServiceLocator.ts tests/unit/runtime/RuntimeServices.test.ts tests/unit/worker/ServiceLocator.test.ts
git commit -m "feat(runtime): expose optional captureEngine with a shared session store"
```

---

### Task 9: 切片 1 收尾验证（全量回归）

**Files:**

- 无新增；只跑检查与（必要时）修
- Test: 全量

- [ ] **Step 1: 确认零行为变更边界**

Run: `git diff --name-only HEAD~8..HEAD`
Expected: 改动文件只落在
`src/modules/session/**`、`src/modules/network/{constants,contentType,NetworkModule}.ts`、`src/modules/proxy/MitmProxyServer.ts`、`src/modules/collector/CdpNetworkMonitor.ts`、`src/utils/withTimeout.ts`、`src/runtime.ts`、`src/runtime/RuntimeServices.ts`、`src/worker/ServiceLocator.ts` 与镜像的 `tests/**`。
出现 `src/web/**`、`src/web-ui/**`、`src/tools/**` 即为越界，回退对应改动。

- [ ] **Step 2: 全量单测 + 集成（相对 Task 0 基线判断）**

Run: `npm run test:unit`
Expected: `# fail` 仍为基线的 **57**，`not ok` 名单与 Task 0 记录的 19 个顶层套件逐条一致（**不得新增、不得改名**）。本切片新增/改写的测试文件（contentType、withTimeout、CaptureSessionManager、SqliteSessionStore、CaptureEngine、`adapters/MitmRequestAdapter`、`adapters/CdpRequestAdapter`、RuntimeServices、ServiceLocator）必须全部落在 pass 侧。

Run: `npm run test:integration`
Expected: 与 Task 0 Step 1b 记下的基线一致（`session-ai-pipeline` 覆盖引擎写入→manager 读取→AI 净化全链，能证明 `CapturedRequestRow | null` 的放宽没破坏调用方）。若该命令在开工时就被记为「不可用」，改跑 Task 0 Step 1b 里的定向命令，要求该文件全绿。

- [ ] **Step 3: 门禁（文件级，不用全量 check-format）**

Run: `npm run typecheck`
Expected: 通过。

Run（对切片 1 全部改动文件；PowerShell 版）:

```powershell
$files = git diff --name-only HEAD~8..HEAD | Where-Object { $_ -match '\.ts$' }
npx prettier --check $files
npx eslint $files
```

Expected: `prettier --check` 输出 `All matched files use Prettier code style!`；`eslint` 对这些文件零 error（既有的 `no-explicit-any` warning 允许，不算新增即达标）。若报 `import/order`，`npx eslint --fix` 后重跑本 Task 单测。

> 不要跑 `npm run check-format`：全量 `eslint --cache .` 在本机会 OOM，`prettier --check .` 有 402 个既有 warn（见 Global Constraints）。若确需全量，先在同一分支外单独提一个 commit 把 `open-source/**` 加进 `eslint.config` 的 `ignores`——那不属于本切片。

- [ ] **Step 4: 契约自检（对照 spec 逐条打勾）**

- `ensureActiveSession()` 单点实现、三个 ingest 共用 —— Task 3 / Task 5 ✅
- WS 只推摘要、无 body —— Task 5（`toSummary` + 断言 `'responseBody' in payload === false`）✅
- 摄入失败不打断生产者、有计数 —— Task 5 ✅
- 配额 5000 / 每 200 次、`trimRequests` 空操作边界 —— Task 4 / Task 5 ✅
- 白名单取体 + 3s 超时 + 1MiB 截断 —— Task 1 / Task 7 ✅
- `Runtime` 可选字段、mock 不炸 —— Task 8 ✅
- 未动 `NetworkRequestCollector`、未动前端、未动 MCP 工具 —— Task 9 Step 1 ✅

- [ ] **Step 5: 标记切片完成**

```bash
git add docs/superpowers/plans/2026-08-28-unified-capture-view-backend-foundation.md
git commit -m "docs(session): record slice 1 completion for unified capture view"
```

完成后进入 spec §14 的**切片 2（接线）**：`SessionCaptureBridge` + `MitmModule.onExchange` 水槽 + `session.request` 频道 + 零订阅者短路 + `createSessionRoutes`。切片 2 需另出一份计划（其 REST/WS 契约依赖本切片产出的 `CapturedRequestSummary`）。
