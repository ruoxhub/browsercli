# Code Simplifier 全局重构 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变任何外部行为的前提下，通过消除重复代码、统一响应/错误处理模式、修复 4 个 P0 缺陷与数据驱动重构，将 `src/` 的冗余行数减少约 1800-2500 行，并提升可维护性。

**Architecture:** 分 7 批（Chunk）递进式改造。每批完成后运行 `npm run typecheck` + 对应目录单测，确保行为不变。第一批先修复最危险的 P0 缺陷，第二批建立跨模块公共 helper（`errorMessage` / `runTool` / `getDebuggerFromContext`），后续批次分别作用于 debugger 域、hook/page/workflow 域、shared 与 config 域、modules 层，最后一批清理死代码与内联正则。每批都通过既有 test fixture（`tests/unit/tools/{debugger,hook,workflow,shared}`）做回归守护。

**Tech Stack:** TypeScript ESM、Node 内置 `node:test`、Zod schema、Prettier（`singleQuote:true, trailingComma:all, arrowParens:avoid, endOfLine:lf`）、Playwright / CDP。

---

## File Structure

| 类型 | 文件 | 职责 |
|---|---|---|
| **修改** | `src/tools/shared/pageResponse.ts` | 扩展为跨模块错误/响应 helper 集中地（新增 `getErrorMessage`、保留 `errorMessage` 别名） |
| **修改** | `src/tools/debugger/index.ts` | 15 个工具改用 `runTool` 包装；删除双重 beautify；删除未用 `maxScopeDepth`；统一响应格式；提取 `getDebuggerFromContext`、`filterMatchesByUrl`、魔数常量 |
| **修改** | `src/tools/debugger/manifest.ts` | 移除 `startContinuousDebugging` / `stopContinuousDebugging` 两条 stub 注册 |
| **修改** | `src/tools/hook/RemoveHookBrowser.ts` | 重命名工具名为 `remove_hook_browser`（冲突修复） |
| **修改** | `src/tools/hook/SyncHookRecords.ts` | 重命名工具名为 `sync_hook_records`（冲突修复） |
| **修改** | `src/tools/hook/{CreateHook,GetHookData,InjectHook,ListCreatedHooks,RemoveHook,RemoveHookBrowser,SyncHookRecords}.ts` | 改用 `errorMessage()`，移除 WHAT 注释 |
| **修改** | `src/tools/workflow/autoHook.ts` | 8 个 `_generateXxxHookScript` 数据驱动合并为 `buildHookScript(preset)`；`buildHookPlans` 改为遍历 `HOOK_PRESETS` 表；`detectCryptoLibraries` 去除 `as any` |
| **修改** | `src/tools/workflow/observeFlow.ts` | 删除 `extractCryptoAlgorithms` 包装；内联正则提升为模块级 `const`；`options` 改为强类型接口 |
| **修改** | `src/tools/workflow/rebuildBundle.ts` | 删除未使用的 `_filterRuntimeEvidence` / `_inferMissingCapabilities`；删除重复 WHAT 注释 |
| **修改** | `src/tools/network/{listNetworkRequests,traceSignatureGeneration}.ts` | 提取共享 `SIGNATURE_HEADER_PATTERN` 到 `src/tools/network/constants.ts` |
| **修改** | `src/tools/page/sessionState.ts` | 6 处 `ensureCleanupLoop+cleanupExpiredSessions` 提取为 `prepareSessionStore()`；消除 `as unknown as` |
| **修改** | `src/tools/shared/response-builder.ts` | `buildInvokeHint` 数据驱动重构（9 同构分支 → 表） |
| **修改** | `src/config/resolver.ts` | `getBrowserManagerConfig` 数据驱动重构（25 同构分支 → 表） |
| **修改** | `src/modules/deobfuscator/AdvancedDeobfuscator.ts` | 删除模块级死代码 `INVISIBLE_CHAR_TO_BIT` / `INVISIBLE_CHARS` / `INVISIBLE_PATTERN` |
| **新增** | `src/tools/network/constants.ts` | 存放 `SIGNATURE_HEADER_PATTERN` 等共享常量 |
| **删除** | `src/tools/debugger/types.ts` | 纯再导出，由 `index.ts` 改为直接从 `../../third_party/index.js` 导出 `Frame` 替代 |
| **测试** | `tests/unit/tools/debugger/index.test.ts` | 扩展：覆盖 `getDebuggerFromContext` / `filterMatchesByUrl` / 魔数阈值边界 |
| **测试** | `tests/unit/tools/shared/pageResponse.test.ts`（新增） | 覆盖 `errorMessage` 与 `getErrorMessage` 语义 |
| **测试** | `tests/unit/tools/workflow/autoHook.test.ts` | 扩展：覆盖 `buildHookScript` 对 8 个 preset 的输出契约 |
| **测试** | `tests/unit/tools/hook/{RemoveHook,SyncHookRecords}.test.ts`（新增） | 覆盖改名后的工具仍能被 ToolRegistry 注册 |

---

## Chunk 1: tools/debugger P0 缺陷修复

> **目标**：修复 4 个 P0 级缺陷，为后续重构扫清地雷。行为改变仅限错误格式统一与未用参数移除。

### Task 1: 删除 `get_script_source` 的双重 beautify bug

**Files:**
- Modify: `src/tools/debugger/index.ts:765-791`
- Test: `tests/unit/tools/debugger/index.test.ts`（扩展 `get_script_source` 用例）

- [ ] **Step 1: 写一个回归测试**

在 `tests/unit/tools/debugger/index.test.ts` 末尾追加：

```typescript
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {getScriptSource} from '../../../src/tools/debugger/index.js';

describe('getScriptSource prettyPrint', () => {
  it('仅对源码 beautify 一次（不双重格式化）', async () => {
    let beautifyCalls = 0;
    const fakeDebuggerContext = {
      getBeautifiedScriptSource: async (
        _scriptId: string,
        beautifier: (raw: string) => string,
      ) => {
        beautifyCalls++;
        return beautifier('raw-source');
      },
      getScriptById: () => ({url: 'https://x/y.js'}),
    };
    const response = {
      payload: undefined as unknown,
      setStructuredContent(c: unknown) {
        this.payload = c;
      },
      appendResponseLine() {},
    };
    // 注入 fake runtime 略（使用 stub context）
    // ... 测试细节视项目 stub 框架而定
    const result = response.payload as {data: {source?: string; sourcePreview?: string}};
    assert.equal(beautifyCalls, 1, 'beautify 只应被回调一次');
    assert.ok(result.data.source || result.data.sourcePreview);
  });
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npm run build && node --test build/tests/unit/tools/debugger/index.test.js`
Expected: FAIL，断言 `beautifyCalls === 1` 得到 `beautifyCalls >= 2`（因为当前代码在 `getBeautifiedScriptSource` 回调里已 beautify 一次，外层 `if (prettyPrint)` 又调了一次）。

- [ ] **Step 3: 删除重复的 if (prettyPrint) 块**

编辑 `src/tools/debugger/index.ts`，删除第 784-791 行：

```typescript
// 删除：
// 格式化源码（可选）
if (prettyPrint) {
  try {
    source = new PackerDeobfuscator().beautify(source);
  } catch {
    // 格式化失败时 fallback 返回原始源码
  }
}
```

保留第 765-772 行的 `getBeautifiedScriptSource` 回调路径。同时在 handler 顶部创建单例（顺带解决 P3-4）：

```typescript
const beautifier = new PackerDeobfuscator();
// ...
source = await debuggerContext.getBeautifiedScriptSource(
  scriptId,
  raw => beautifier.beautify(raw),
);
```

- [ ] **Step 4: 再跑测试**

Run: `npm run build && node --test build/tests/unit/tools/debugger/index.test.js`
Expected: PASS；`beautifyCalls === 1`。

- [ ] **Step 5: Commit**

```bash
git add src/tools/debugger/index.ts tests/unit/tools/debugger/index.test.ts
git commit -m "fix(debugger): remove duplicate beautify in get_script_source"
```

---

### Task 2: 移除 `get_paused_info` 未使用的 `maxScopeDepth` 参数

**Files:**
- Modify: `src/tools/debugger/index.ts:1614-1634`
- Test: `tests/unit/tools/debugger/buildPausedInfoData.test.ts`（确认现有测试仍通过）

- [ ] **Step 1: 确认 schema 当前声明**

`src/tools/debugger/index.ts:1620-1625` 声明了 `maxScopeDepth`，但第 1632 行调用 `buildPausedInfoData(debuggerContext, { includeScopes })` 只传了 `includeScopes`。

- [ ] **Step 2: 跑现有 buildPausedInfoData 测试，确认基准**

Run: `npm run build && node --test build/tests/unit/tools/debugger/buildPausedInfoData.test.js`
Expected: PASS。

- [ ] **Step 3: 从 schema 删除 `maxScopeDepth`**

编辑 `src/tools/debugger/index.ts`，删除第 1620-1625 行的 `maxScopeDepth` 字段定义（含尾部逗号），保持 `includeScopes` 不变。

- [ ] **Step 4: 再跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/debugger/*.test.js`
Expected: PASS，且无 TS 报错。

- [ ] **Step 5: Commit**

```bash
git add src/tools/debugger/index.ts
git commit -m "fix(debugger): drop unused maxScopeDepth schema param in get_paused_info"
```

---

### Task 3: 统一 `trace_function` 校验失败路径的响应格式

**Files:**
- Modify: `src/tools/debugger/index.ts:1180-1193`
- Test: `tests/unit/tools/debugger/index.test.ts`

- [ ] **Step 1: 增加回归测试**

在 `tests/unit/tools/debugger/index.test.ts` 追加：

```typescript
describe('trace_function validation', () => {
  it('target 为空时使用 setStructuredContent 而非 appendResponseLine', async () => {
    const lines: string[] = [];
    let structured: unknown = undefined;
    const response = {
      appendResponseLine(v: string) { lines.push(v); },
      setStructuredContent(c: unknown) { structured = c; },
    };
    await traceFunction.handler(
      {params: {target: ''}},
      response as any,
      {} as any,
    );
    assert.equal(lines.length, 0, '不应调用 appendResponseLine');
    assert.deepEqual(
      (structured as {success: boolean; tooltype: string}).success,
      false,
    );
    assert.equal(
      (structured as {tooltype: string}).tooltype,
      'trace_function',
    );
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npm run build && node --test build/tests/unit/tools/debugger/index.test.js`
Expected: FAIL（当前代码走 `appendResponseLine`）。

- [ ] **Step 3: 把两处 appendResponseLine 改为 setStructuredContent**

编辑 `src/tools/debugger/index.ts`：

```typescript
if (!target || typeof target !== 'string') {
  response.setStructuredContent({
    success: false,
    message: 'target 参数不能为空。需要提供一个函数名。',
    tooltype: 'trace_function',
    data: {target},
  });
  return;
}

const debugger_ = await getDebugger(runtime);
if (!debugger_.isEnabled()) {
  response.setStructuredContent({
    success: false,
    message: '调试器未启用，请先选择页面。',
    tooltype: 'trace_function',
    data: {target},
  });
  return;
}
```

- [ ] **Step 4: 再跑测试**

Run: `npm run build && node --test build/tests/unit/tools/debugger/index.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/debugger/index.ts tests/unit/tools/debugger/index.test.ts
git commit -m "fix(debugger): unify trace_function validation response format"
```

---

### Task 4: 从 manifest 移除 `startContinuousDebugging` / `stopContinuousDebugging` stub

**Files:**
- Modify: `src/tools/debugger/index.ts:2038-2083`（删除导出）
- Modify: `src/tools/debugger/manifest.ts:66-71`（删除注册）
- Test: `tests/unit/tools/ToolRegistry.test.ts`（确认不注册）

- [ ] **Step 1: 写一个回归测试**

在 `tests/unit/tools/ToolRegistry.test.ts` 或新文件追加：

```typescript
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {registry} from '../../../src/tools/registry/index.js'; // 实际路径

test('debugger domain 不注册 start_continuous_debugging / stop_continuous_debugging', () => {
  const names = registry.all().map(t => t.name);
  assert.ok(!names.includes('start_continuous_debugging'));
  assert.ok(!names.includes('stop_continuous_debugging'));
});
```

> 注意：若 registry 路径未知，可先 `grep -rn "start_continuous_debugging" src` 定位注册入口；若无集中 registry，则删除 manifest 行即为唯一断言点，改由 manifest 加载器测试守护。

- [ ] **Step 2: 跑测试确认现状**

Run: `npm run build && node --test build/tests/unit/tools/ToolRegistry.test.js`
Expected: FAIL（当前两个 stub 已注册）。

- [ ] **Step 3: 删除 `index.ts` 的两个 stub 导出**

删除 `src/tools/debugger/index.ts:2038-2083`（`startContinuousDebugging` 与 `stopContinuousDebugging` 两个 `defineTool` 块及其上方 JSDoc 注释）。

- [ ] **Step 4: 删除 `manifest.ts` 的两条注册**

删除 `src/tools/debugger/manifest.ts:66-71`：

```typescript
{modulePath: './debugger/index.js', handlerName: 'startContinuousDebugging'},
{modulePath: './debugger/index.js', handlerName: 'stopContinuousDebugging'},
```

- [ ] **Step 5: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/ToolRegistry.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/tools/debugger/index.ts src/tools/debugger/manifest.ts tests/unit/tools/ToolRegistry.test.ts
git commit -m "fix(debugger): drop stub tools start/stop_continuous_debugging"
```

---

## Chunk 2: 提取跨模块公共 helper

> **目标**：把 `error instanceof Error ? error.message : String(error)` 这一个表达式（50+ 处内联）与 `sendJson`/`setStructuredContent` 的双轨响应模式收敛到一个明确的 helper 集合。

### Task 5: 扩展 `pageResponse.ts` 为公共 helper 中心

**Files:**
- Modify: `src/tools/shared/pageResponse.ts`
- Test: `tests/unit/tools/shared/pageResponse.test.ts`（新增）

- [ ] **Step 1: 写 helper 单元测试**

新增 `tests/unit/tools/shared/pageResponse.test.ts`：

```typescript
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {errorMessage, getErrorMessage} from '../../../src/tools/shared/pageResponse.js';

describe('errorMessage / getErrorMessage', () => {
  it('Error 实例返回 message', () => {
    assert.equal(errorMessage(new Error('boom')), 'boom');
    assert.equal(getErrorMessage(new Error('boom')), 'boom');
  });
  it('字符串返回原值', () => {
    assert.equal(errorMessage('oops'), 'oops');
    assert.equal(getErrorMessage('oops'), 'oops');
  });
  it('数字/对象返回 String(v)', () => {
    assert.equal(errorMessage(42), '42');
    assert.equal(getErrorMessage({a: 1}), '[object Object]');
  });
  it('null/undefined 返回 "null"/"undefined"', () => {
    assert.equal(errorMessage(null), 'null');
    assert.equal(getErrorMessage(undefined), 'undefined');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && node --test build/tests/unit/tools/shared/pageResponse.test.js`
Expected: FAIL（`getErrorMessage` 未导出）。

- [ ] **Step 3: 实现 `getErrorMessage` 并保留 `errorMessage` 别名**

编辑 `src/tools/shared/pageResponse.ts`：

```typescript
import type {Response} from '../ToolDefinition.js';

export function sendJson(response: Response, payload: unknown): void {
  response.setStructuredContent(payload);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** @deprecated 别名，新代码请用 getErrorMessage */
export const errorMessage = getErrorMessage;
```

- [ ] **Step 4: 跑测试**

Run: `npm run build && node --test build/tests/unit/tools/shared/pageResponse.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/shared/pageResponse.ts tests/unit/tools/shared/pageResponse.test.ts
git commit -m "refactor(shared): expose getErrorMessage helper"
```

---

### Task 6: 导出 debugger `runTool` 给其他模块复用

**Files:**
- Modify: `src/tools/debugger/index.ts:69-92`（加 `export`）
- Modify: `src/tools/debugger/runtime-helpers.ts`（新增，抽出 `getDebugger` + `runTool`）
- Test: `tests/unit/tools/debugger/index.test.ts`（既有）

- [ ] **Step 1: 创建 `runtime-helpers.ts`**

新建 `src/tools/debugger/runtime-helpers.ts`：

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import type {DebuggerContext} from '../../DebuggerContext.js';
import {getErrorMessage} from '../shared/pageResponse.js';

export type DebuggerRuntime = {
  getDebuggerContext(): Promise<DebuggerContext>;
};

export async function getDebuggerFromContext(
  runtime: unknown,
): Promise<DebuggerContext> {
  if (
    !runtime ||
    typeof (runtime as DebuggerRuntime).getDebuggerContext !== 'function'
  ) {
    throw new Error(
      '缺少调试运行时上下文。请确保：1) 已选中页面；2) 工具通过 defineTool 上下文调用（ToolAdapter）。',
    );
  }
  try {
    return await (runtime as DebuggerRuntime).getDebuggerContext();
  } catch (err) {
    throw new Error(`获取调试上下文失败: ${getErrorMessage(err)}`);
  }
}

export async function runTool<P = unknown>(
  response: {setStructuredContent(content: unknown): void},
  request: {params: P},
  tooltype: string,
  run: () => Promise<void>,
  options: {
    errorData?: (params: P) => Record<string, unknown>;
    errorPrefix?: string;
  } = {},
): Promise<void> {
  const {errorData = () => ({}), errorPrefix} = options;
  try {
    await run();
  } catch (error) {
    const raw = getErrorMessage(error);
    const message = errorPrefix ? `${errorPrefix}: ${raw}` : raw;
    response.setStructuredContent({
      success: false,
      message,
      tooltype,
      data: errorData(request.params),
    });
  }
}
```

- [ ] **Step 2: 修改 `index.ts` 改为从 helpers 导入**

替换 `src/tools/debugger/index.ts:29-92`：

```typescript
import {getDebuggerFromContext, runTool} from './runtime-helpers.js';
```

并全局替换 `await getDebugger(runtime)` → `await getDebuggerFromContext(runtime)`，删除本地 `DebuggerRuntime` type 别名与 `getDebugger` / `runTool` 函数定义。

- [ ] **Step 3: 跑 debugger 全部单测**

Run: `npm run build && node --test build/tests/unit/tools/debugger/*.test.js`
Expected: PASS（纯重构，无行为变化）。

- [ ] **Step 4: Commit**

```bash
git add src/tools/debugger/index.ts src/tools/debugger/runtime-helpers.ts
git commit -m "refactor(debugger): extract runtime-helpers for reuse"
```

---

### Task 7: 提取 `filterMatchesByUrl` + 魔数常量

**Files:**
- Modify: `src/tools/debugger/index.ts`
- Test: `tests/unit/tools/debugger/index.test.ts`

- [ ] **Step 1: 在 `runtime-helpers.ts` 追加**

```typescript
export function filterMatchesByUrl<T>(
  matches: T[],
  urlFilter: string | undefined,
  getUrl: (m: T) => string | undefined | null,
): T[] {
  if (!urlFilter) return matches;
  const lower = urlFilter.toLowerCase();
  return matches.filter(m => {
    const u = getUrl(m);
    return typeof u === 'string' && u.toLowerCase().includes(lower);
  });
}

// 源码大小阈值（字符数）
export const MINIFIED_LINE_THRESHOLD = 100_000;
export const LARGE_FILE_THRESHOLD = 50_000;
export const DEFAULT_PREVIEW_LENGTH = 1_000;
export const SCOPE_VAR_LIMIT = 20;
export const DEFAULT_MAX_RESULTS = 30;
export const DEFAULT_MAX_LINE_LENGTH = 150;
```

- [ ] **Step 2: 替换 `index.ts` 三处 URL 过滤与魔数**

```typescript
// searchInSources (1005-1009)
matches = filterMatchesByUrl(matches, urlFilter, m => m.url);

// traceFunction (1220-1224)
matches = filterMatchesByUrl(matches, urlFilter, m => m.url);

// setBreakpointOnText (1918-1921)
matches = filterMatchesByUrl(matches, urlFilter, m => m.url);

// 魔数替换
// 第 851 行 source.length > 50000 → source.length > LARGE_FILE_THRESHOLD
// 第 799 行 length || 1000 → length || DEFAULT_PREVIEW_LENGTH
// 第 861 行 source.substring(0, 1000) → source.substring(0, DEFAULT_PREVIEW_LENGTH)
// 第 1013 行 < 100000 → < MINIFIED_LINE_THRESHOLD（行号以最新为准）
```

- [ ] **Step 3: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/debugger/*.test.js`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/tools/debugger/index.ts src/tools/debugger/runtime-helpers.ts
git commit -m "refactor(debugger): extract filterMatchesByUrl + named thresholds"
```

---

## Chunk 3: `debugger/index.ts` 15 工具 runTool 化 + 消除 18 处双重转型

> **目标**：把 `index.ts` 从 2083 行降到 ~1650 行，靠删除重复 try/catch 与 18 处 `const runtime = context as unknown as DebuggerRuntime`。

### Task 8: 批量改写 15 个工具为 `runTool` 包装

**Files:**
- Modify: `src/tools/debugger/index.ts`
- Test: `tests/unit/tools/debugger-tools.error-paths.test.ts`（既有）

- [ ] **Step 1: 列出既有错误路径测试**

Run: `npm run build && node --test build/tests/unit/tools/debugger-tools.error-paths.test.js`
Expected: PASS（基准）。

- [ ] **Step 2: 按以下顺序逐个改写**

对每个工具的 handler，把形如：

```typescript
handler: async (request, response, context) => {
  const runtime = context as unknown as DebuggerRuntime;
  try {
    const debuggerContext = await getDebuggerFromContext(runtime);
    // 业务逻辑
  } catch (error) {
    response.setStructuredContent({
      success: false,
      message: `XXX失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'xxx',
      data: {...}
    });
  }
}
```

改为：

```typescript
handler: async (request, response, context) => {
  await runTool(response, request, 'xxx', async () => {
    const debuggerContext = await getDebuggerFromContext(context);
    // 业务逻辑（成功路径直接调用 response.setStructuredContent）
  }, {
    errorPrefix: 'XXX失败',
    errorData: params => ({scriptId: params.scriptId}), // 按需
  });
}
```

按以下顺序改写（已核对行号范围）：

| # | 工具 | 原行号 | errorPrefix |
|---|---|---|---|
| 1 | `setBreakpoint` | 382-419 | `'设置断点失败'` |
| 2 | `removeBreakpoint` | 451-467 | `'删除断点失败'` |
| 3 | `listBreakpoints` | 486-523 | `'列出断点失败'` |
| 4 | `resume` | 583-600 | `'恢复执行失败'` |
| 5 | `pause` | 618-645 | `'暂停执行失败'` |
| 6 | `listScripts` | 669-713 | `'列出脚本失败'` |
| 7 | `getScriptSource` | 762-888 | `'获取脚本源码失败'` |
| 8 | `searchInSources` | 966-1109 | `'搜索脚本源码失败'` |
| 9 | `traceFunction` | 1207-1332 | `'追踪函数失败'` |
| 10 | `getAiDebugStatus` | 1351-1383 | `'获取 AI 调试状态失败'` |
| 11 | `findInScript` | 1426-1526 | `'在脚本中查找失败'` |
| 12 | `getRequestInitiator` | 1551-1599 | `'获取请求发起者失败'` |
| 13 | `getPausedInfo` | 1630-1667 | `'获取暂停信息失败'` |
| 14 | `evaluateOnCallframe` | 1695-1762 | `'在调用帧上执行失败'` |
| 15 | `inspectLocals` | 1781-1855 | `'检查局部变量失败'` |
| 16 | `setBreakpointOnText` | 1897-2017 | `'在文本上设置断点失败'` |

> 注意：`traceFunction` 在校验失败路径已用 `setStructuredContent`（Task 3），改写时保持 early-return 不变，只包外层正常 try/catch。

- [ ] **Step 3: 删除 18 处 `const runtime = context as unknown as DebuggerRuntime`**

改写后 handler 内部直接使用 `context`（`runTool` 不要求转型，`getDebuggerFromContext` 接收 `unknown`），删除所有形如：

```typescript
const runtime = context as unknown as DebuggerRuntime;
```

的行（共 18 处，行号见 debugger agent 报告 P1-1）。

- [ ] **Step 4: 跑全套 debugger 单测 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/debugger/*.test.js build/tests/unit/tools/debugger-tools.*.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/debugger/index.ts
git commit -m "refactor(debugger): wrap 15 tools with runTool + drop 18 double casts"
```

---

### Task 9: 统一 `ToolCategory` 字符串字面量为枚举

**Files:**
- Modify: `src/tools/debugger/index.ts`
- Test: `tests/unit/tools/ToolRegistry.test.ts`

- [ ] **Step 1: 把 `'debugging' as ToolCategory` 全部替换为 `ToolCategory.DEBUGGING`**

`index.ts` 第 10 行改为：

```typescript
import {ToolCategory} from '../categories.js';
```

然后全局替换 `'debugging' as ToolCategory` → `ToolCategory.DEBUGGING`（约 20 处）。

- [ ] **Step 2: 跑 typecheck + ToolRegistry 测试**

Run: `npm run typecheck && node --test build/tests/unit/tools/ToolRegistry.test.js`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/tools/debugger/index.ts
git commit -m "refactor(debugger): use ToolCategory enum instead of string literals"
```

---

### Task 10: 删除 `src/tools/debugger/types.ts`

**Files:**
- Delete: `src/tools/debugger/types.ts`
- Modify: `src/tools/debugger/index.ts:25`
- Test: `tests/unit/tools/debugger/contextSelector.test.ts`（既有）

- [ ] **Step 1: 查找所有消费者**

Run: `grep -rn "from './types.js'\|from '../debugger/types.js'" src/`
Expected: 仅 `src/tools/debugger/index.ts:25`。

- [ ] **Step 2: 改 index.ts 直接导出 Frame**

把 `src/tools/debugger/index.ts:25`：

```typescript
export type {Frame} from './types.js';
```

改为：

```typescript
export type {Frame} from '../../third_party/index.js';
```

- [ ] **Step 3: 删除 `types.ts`**

```bash
git rm src/tools/debugger/types.ts
```

- [ ] **Step 4: 跑 typecheck + 测试**

Run: `npm run typecheck && node --test build/tests/unit/tools/debugger/*.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/debugger/index.ts src/tools/debugger/types.ts
git commit -m "refactor(debugger): drop types.ts re-export shim"
```

---

## Chunk 4: hook / page / workflow 工具域

### Task 11: 修复 hook 工具名冲突

**Files:**
- Modify: `src/tools/hook/RemoveHookBrowser.ts:21`
- Modify: `src/tools/hook/SyncHookRecords.ts:17`
- Modify: `src/tools/hook/manifest.ts`（若有）
- Test: `tests/unit/tools/hook/RemoveHook.test.ts`（新增）、`tests/unit/tools/hook/SyncHookRecords.test.ts`（新增）

- [ ] **Step 1: 写测试断言唯一 name**

新增 `tests/unit/tools/hook/RemoveHook.test.ts`：

```typescript
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {removeHook} from '../../../src/tools/hook/RemoveHook.js';
import {removeHookBrowser} from '../../../src/tools/hook/RemoveHookBrowser.js';

test('removeHook 与 removeHookBrowser 名称不冲突', () => {
  assert.notEqual(removeHook.name, removeHookBrowser.name);
  assert.equal(removeHook.name, 'remove_hook');
  assert.equal(removeHookBrowser.name, 'remove_hook_browser');
});
```

新增 `tests/unit/tools/hook/SyncHookRecords.test.ts`：

```typescript
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {listCreatedHooks} from '../../../src/tools/hook/ListCreatedHooks.js';
import {syncHookRecords} from '../../../src/tools/hook/SyncHookRecords.js';

test('listCreatedHooks 与 syncHookRecords 名称不冲突', () => {
  assert.notEqual(listCreatedHooks.name, syncHookRecords.name);
  assert.equal(listCreatedHooks.name, 'list_created_hooks');
  assert.equal(syncHookRecords.name, 'sync_hook_records');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run build && node --test build/tests/unit/tools/hook/RemoveHook.test.js build/tests/unit/tools/hook/SyncHookRecords.test.js`
Expected: FAIL（当前冲突）。

- [ ] **Step 3: 修改 `RemoveHookBrowser.ts` name**

```typescript
name: 'remove_hook_browser',
```

同时把文件内所有 `tooltype: 'remove_hook'` 改为 `tooltype: 'remove_hook_browser'`（约 2 处）。

- [ ] **Step 4: 修改 `SyncHookRecords.ts` name**

```typescript
name: 'sync_hook_records',
```

同时把 `tooltype: 'list_created_hooks'` 改为 `tooltype: 'sync_hook_records'`（约 3 处）。

- [ ] **Step 5: 同步更新 manifest（若存在）**

```bash
grep -rn "'list_created_hooks'\|'remove_hook'" src/tools/hook/manifest.ts
```

若有，更新对应 handlerName 保留但 name 字段无需（manifest 通常只引用 module+handler，无需改）。

- [ ] **Step 6: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/hook/*.test.js`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/tools/hook/RemoveHookBrowser.ts src/tools/hook/SyncHookRecords.ts tests/unit/tools/hook/RemoveHook.test.ts tests/unit/tools/hook/SyncHookRecords.test.ts
git commit -m "fix(hook): disambiguate remove_hook and list_created_hooks tool names"
```

---

### Task 12: hook 工具批量改用 `errorMessage` + 删除 WHAT 注释

**Files:**
- Modify: `src/tools/hook/{CreateHook,GetHookData,InjectHook,ListCreatedHooks,RemoveHook,RemoveHookBrowser,SyncHookRecords}.ts`
- Test: `tests/unit/tools/jshook-tools.handlers.test.ts`（既有）

- [ ] **Step 1: 跑基准测试**

Run: `npm run build && node --test build/tests/unit/tools/jshook-tools.handlers.test.js build/tests/unit/tools/jshook-tools.test.js`
Expected: PASS。

- [ ] **Step 2: 全局替换 21 处 `error instanceof Error ? error.message : String(error)`**

对每个文件追加导入：

```typescript
import {errorMessage} from '../shared/pageResponse.js';
```

然后用 Edit/VSCode regex 替换：

```
error instanceof Error \? error\.message : String\(error\)
→
errorMessage(error)
```

预期替换 21 处（行号见 hook-net agent 报告 §二）。

- [ ] **Step 3: 删除 WHAT 注释**

在以下位置删除编号步骤注释（仅描述代码做什么）：

- `hook/GetHookData.ts:73` `// 1. 先从浏览器同步数据到 HookManager`
- `hook/ListCreatedHooks.ts:51` `// 1. 可选：从浏览器同步数据到 HookStore`
- `hook/RemoveHook.ts:50,53` `// 1. 从进程内 HookManager 删除…` / `// 2. 可选：清理浏览器端数据…`
- `hook/InjectHook.ts` 中同模式的编号注释

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/jshook-tools.handlers.test.js build/tests/unit/tools/jshook-tools.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/tools/hook/
git commit -m "refactor(hook): use errorMessage helper and drop what-comments"
```

---

### Task 13: 提取 `prepareSessionStore` helper + 删除 `as unknown as`

**Files:**
- Modify: `src/tools/page/sessionState.ts`
- Test: `tests/unit/tools/basic-tools.extended.test.ts`（既有）

- [ ] **Step 1: 跑基准测试**

Run: `npm run build && node --test build/tests/unit/tools/basic-tools.extended.test.js`
Expected: PASS。

- [ ] **Step 2: 在文件顶部新增 helper**

```typescript
function prepareSessionStore(): void {
  ensureCleanupLoop();
  cleanupExpiredSessions();
}
```

- [ ] **Step 3: 替换 6 处 `ensureCleanupLoop(); cleanupExpiredSessions();` 为 `prepareSessionStore();`**

行号：184-185 / 286-287 / 375-376 / 416-417 / 450-451 / 524-525。

- [ ] **Step 4: 替换 `cookies as unknown as Array<Record<string, unknown>>`**

引入 Playwright 的 `Cookie` 类型（`import type {Cookie} from 'playwright'` 或项目内封装），删除 `as unknown as`。若上游已返回正确类型，直接移除多余断言。

- [ ] **Step 5: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/basic-tools.extended.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/tools/page/sessionState.ts
git commit -m "refactor(page): extract prepareSessionStore and drop unsafe casts"
```

---

### Task 14: 数据驱动重构 `autoHook.ts`

**Files:**
- Modify: `src/tools/workflow/autoHook.ts`
- Test: `tests/unit/tools/workflow/autoHook.test.ts`（既有）

- [ ] **Step 1: 跑基准测试并记录用例数**

Run: `npm run build && node --test build/tests/unit/tools/workflow/autoHook.test.js`
Expected: PASS。记录通过数 N。

- [ ] **Step 2: 定义 `HOOK_PRESETS` 表**

在 `autoHook.ts` 顶部（`PRESET_CONFIGS` 之后）新增：

```typescript
interface HookPreset {
  optionKey: keyof AutoHookOptions;
  hookId: string;
  type: string;
  description: string;
  buildScript: () => string;
}

const HOOK_PRESETS: HookPreset[] = [
  {optionKey: 'hookFetch', hookId: 'hook_fetch_auto', type: 'fetch',
   description: 'Hook fetch API - capture requests and responses',
   buildScript: () => _generateFetchHookScript()},
  {optionKey: 'hookXhr', hookId: 'hook_xhr_auto', type: 'xhr',
   description: 'Hook XMLHttpRequest - capture XHR requests',
   buildScript: () => _generateXhrHookScript()},
  {optionKey: 'hookTimers', hookId: 'hook_timers_auto', type: 'timer',
   description: 'Hook setTimeout/setInterval',
   buildScript: () => _generateTimerHookScript()},
  {optionKey: 'hookEval', hookId: 'hook_eval_auto', type: 'eval',
   description: 'Hook eval and Function constructor',
   buildScript: () => _generateEvalHookScript()},
  {optionKey: 'hookStorage', hookId: 'hook_storage_auto', type: 'storage',
   description: 'Hook localStorage/sessionStorage',
   buildScript: () => _generateStorageHookScript()},
  {optionKey: 'hookCookie', hookId: 'hook_cookie_auto', type: 'cookie',
   description: 'Hook Document.cookie',
   buildScript: () => _generateCookieHookScript()},
  {optionKey: 'hookCryptoJs', hookId: 'hook_cryptojs_auto', type: 'cryptojs',
   description: 'Hook CryptoJS',
   buildScript: () => _generateCryptoJsHookScript()},
  {optionKey: 'hookWebCrypto', hookId: 'hook_webcrypto_auto', type: 'webcrypto',
   description: 'Hook WebCrypto subtle API',
   buildScript: () => _generateWebCryptoHookScript()},
];
```

- [ ] **Step 3: 改写 `buildHookPlans` 为表驱动**

```typescript
function buildHookPlans(
  options: AutoHookOptions,
): Array<HookInjectionRecord & {script: string}> {
  return HOOK_PRESETS
    .filter(p => options[p.optionKey])
    .map(p => ({
      hookId: p.hookId,
      type: p.type,
      description: p.description,
      success: true,
      injected: false,
      script: p.buildScript(),
    }));
}
```

删除旧的 8 个 `if (options.hookXxx)` 块（954-1048 行）。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/workflow/autoHook.test.js`
Expected: PASS，用例数 ≥ N。

- [ ] **Step 5: Commit**

```bash
git add src/tools/workflow/autoHook.ts
git commit -m "refactor(workflow): data-driven autoHook preset table"
```

---

### Task 15: 清理 `observeFlow.ts` + `rebuildBundle.ts` 死代码 + 正则提升

**Files:**
- Modify: `src/tools/workflow/observeFlow.ts`
- Modify: `src/tools/workflow/rebuildBundle.ts`
- Test: `tests/unit/tools/workflow/observeFlow.test.ts` / `rebuildBundle.test.ts`

- [ ] **Step 1: 跑基准测试**

Run: `npm run build && node --test build/tests/unit/tools/workflow/observeFlow.test.js build/tests/unit/tools/workflow/rebuildBundle.test.js`
Expected: PASS。

- [ ] **Step 2: 删除 `extractCryptoAlgorithms` 包装**

在 `observeFlow.ts:363-365` 删除：

```typescript
function extractCryptoAlgorithms(content: string): string[] {
  return extractCryptoAlgo(content);
}
```

并把所有 `extractCryptoAlgorithms` 调用者重命名为 `extractCryptoAlgo`。

- [ ] **Step 3: 提升内联正则为模块级 `const`**

在 `observeFlow.ts` 顶部新增：

```typescript
const ENCRYPTION_KEYWORDS = /aes|rsa|des|md5|sha[0-9]*|hmac|pbkdf|encrypt|decrypt|cipher/i;
const API_KEYWORDS = /fetch|axios|xmlhttprequest|ajax|\/api\//i;
const OBFUSCATION_PATTERNS = [/\\x[0-9a-f]{2}/i, /\\u[0-9a-f]{4}/i, /eval\s*\(/, /atob\s*\(/, /btoa\s*\(/, /unescape\s*\(/];
// ... 其他 8 类
```

把 `detectEncryption` / `detectAPI` / `detectObfuscation` / `extractCryptoAlgo` / `detectCryptoLibraries` / `extractFunctions` / `extractImports` / `detectThirdPartyLibs` / `isEntryPoint` 内部的内联正则替换为常量引用。

- [ ] **Step 4: 定义 `CollectScriptsOptions` 接口**

```typescript
interface CollectScriptsOptions {
  includeInline?: boolean;
  includeEval?: boolean;
  maxScripts?: number;
  // 其他字段见 observeFlow.ts:146
}

function collectScripts(url: string, options: CollectScriptsOptions) { /* ... */ }
```

删除 `(options.includeInline as boolean) ?? true` 等处的 `as boolean` 断言。

- [ ] **Step 5: 删除 `rebuildBundle.ts` 未使用函数**

删除第 194-218 行 `_filterRuntimeEvidence` 与 223-275 行 `_inferMissingCapabilities`。
先确认：

```bash
grep -rn "_filterRuntimeEvidence\|_inferMissingCapabilities" src/
```

若除定义外无调用，删除；若有外部引用，保留并加 `@internal` JSDoc。

- [ ] **Step 6: 删除 WHAT 注释**

删除 `rebuildBundle.ts:338-375` 中 `// 1. 收集逆向工程证据` 至 `// 6. 返回结果` 共 6 处步骤注释。

- [ ] **Step 7: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/workflow/*.test.js`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/tools/workflow/observeFlow.ts src/tools/workflow/rebuildBundle.ts
git commit -m "refactor(workflow): drop dead code, hoist regex, type options"
```

---

### Task 16: 提取 `SIGNATURE_HEADER_PATTERN` 共享常量

**Files:**
- Create: `src/tools/network/constants.ts`
- Modify: `src/tools/network/listNetworkRequests.ts:63`
- Modify: `src/tools/workflow/traceSignatureGeneration.ts:14`
- Test: 无（纯常量）

- [ ] **Step 1: 创建 `constants.ts`**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
export const SIGNATURE_HEADER_PATTERN =
  /(^|[-_])(sign|signature|token|auth|nonce|timestamp)([-_]|$)|x-sign/i;
```

- [ ] **Step 2: 替换两处定义**

在 `listNetworkRequests.ts` 与 `traceSignatureGeneration.ts` 顶部改为：

```typescript
import {SIGNATURE_HEADER_PATTERN} from '../network/constants.js';
// 或（workflow 目录）
import {SIGNATURE_HEADER_PATTERN} from '../network/constants.js';
```

删除本地 `const SIGNATURE_HEADER_PATTERN = ...`。

- [ ] **Step 3: 跑 typecheck + 相关测试**

Run: `npm run typecheck && node --test build/tests/unit/tools/network/*.test.js build/tests/unit/tools/workflow/*.test.js`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/tools/network/constants.ts src/tools/network/listNetworkRequests.ts src/tools/workflow/traceSignatureGeneration.ts
git commit -m "refactor(network): share SIGNATURE_HEADER_PATTERN constant"
```

---

## Chunk 5: shared / config 数据驱动重构

### Task 17: `response-builder.ts` `buildInvokeHint` 数据驱动

**Files:**
- Modify: `src/tools/shared/response-builder.ts`
- Test: `tests/unit/tools/shared/response-builder.test.ts`（既有）

- [ ] **Step 1: 跑基准测试并记录用例数**

Run: `npm run build && node --test build/tests/unit/tools/shared/response-builder.test.js`
Expected: PASS。

- [ ] **Step 2: 读取 `buildInvokeHint` 定位 9 个同构分支**

```bash
grep -n "function buildInvokeHint\|case '" src/tools/shared/response-builder.ts
```

- [ ] **Step 3: 引入 `INVOKE_HINT_TABLE`**

```typescript
interface InvokeHintRow {
  key: string;
  requiredParams: string[];
  optionalParams?: string[];
  toolClass: 'task' | 'orchestration' | 'rebuild' | 'analysis';
}

const INVOKE_HINT_TABLE: InvokeHintRow[] = [
  // 把 9 个 if/case 分支按原顺序抄到这里
];
```

- [ ] **Step 4: 改写 `buildInvokeHint`**

```typescript
export function buildInvokeHint(key: string): ContinuationInvokeHint | undefined {
  const row = INVOKE_HINT_TABLE.find(r => r.key === key);
  if (!row) return undefined;
  return {
    requiredParams: row.requiredParams,
    optionalParams: row.optionalParams,
    // ... 其他字段
  };
}
```

- [ ] **Step 5: 跑测试 + typecheck**

Run: `npm run typecheck && node --test build/tests/unit/tools/shared/response-builder.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/tools/shared/response-builder.ts
git commit -m "refactor(shared): data-drive buildInvokeHint"
```

---

### Task 18: `config/resolver.ts` `getBrowserManagerConfig` 数据驱动

**Files:**
- Modify: `src/config/resolver.ts`
- Test: `tests/unit/config/resolver.test.ts`（若有）或 `tests/unit/basic-tools.extended.test.ts`

- [ ] **Step 1: 跑基准测试**

Run: `npm run build && node --test build/tests/unit/config/*.test.js 2>/dev/null || echo "no config tests"`
Expected: PASS 或 no config tests。

- [ ] **Step 2: 读取 `getBrowserManagerConfig` 定位 25 个同构分支**

```bash
grep -n "function getBrowserManagerConfig\|if (" src/config/resolver.ts
```

- [ ] **Step 3: 引入 `BROWSER_CONFIG_TABLE`**

```typescript
interface BrowserConfigRow {
  key: string;
  defaults: Record<string, unknown>;
  envVar?: string;
}

const BROWSER_CONFIG_TABLE: BrowserConfigRow[] = [
  // 25 个分支逐条列出
];
```

- [ ] **Step 4: 改写 `getBrowserManagerConfig`**

```typescript
export function getBrowserManagerConfig(kind: string): Record<string, unknown> {
  const row = BROWSER_CONFIG_TABLE.find(r => r.key === kind);
  if (!row) return DEFAULT_BROWSER_CONFIG;
  return {...row.defaults, ...(process.env[row.envVar ?? ''] ? {/* env override */} : {})};
}
```

- [ ] **Step 5: 跑 typecheck + 所有依赖此 resolver 的测试**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/config/resolver.ts
git commit -m "refactor(config): data-drive getBrowserManagerConfig"
```

---

## Chunk 6: modules 层死代码与模板重复

### Task 19: 删除 `AdvancedDeobfuscator` 死代码常量

**Files:**
- Modify: `src/modules/deobfuscator/AdvancedDeobfuscator.ts:55-64`
- Test: `tests/unit/modules/deobfuscator/*.test.ts`（若有）

- [ ] **Step 1: 跑基准测试**

Run: `npm run build && node --test build/tests/unit/modules/deobfuscator/*.test.js 2>/dev/null || echo "no tests"`
Expected: PASS 或 no tests。

- [ ] **Step 2: 确认未使用**

```bash
grep -rn "INVISIBLE_CHAR_TO_BIT\|INVISIBLE_CHARS\|INVISIBLE_PATTERN" src/
```

Expected: 只在 `AdvancedDeobfuscator.ts` 模块级定义，方法体内有同名本地定义（遮蔽）。

- [ ] **Step 3: 删除第 55-64 行**

```bash
git add -p src/modules/deobfuscator/AdvancedDeobfuscator.ts
```

- [ ] **Step 4: 跑 typecheck + 测试**

Run: `npm run typecheck && npm run test:unit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/deobfuscator/AdvancedDeobfuscator.ts
git commit -m "refactor(deobfuscator): drop dead module-level constants in AdvancedDeobfuscator"
```

---

### Task 20: `HookTypeRegistry` 提取 `customBuild` 共享模板片段（可选）

> **Scope note**: 这是 modules 层最复杂的重复源（247 次 `lines.push`），但改造风险较高。若时间紧，可跳过，保留 TODO。

**Files:**
- Modify: `src/modules/hook/HookTypeRegistry.ts`
- Test: `tests/unit/modules/hook/HookTypeRegistry.test.ts`（若有）

- [ ] **Step 1: 跑基准测试**

- [ ] **Step 2: 识别 4-6 次重复模板片段**（记录存储 / 阻止动作 / 生命周期钩子）

- [ ] **Step 3: 提取 `buildStoreSetup()` / `buildBlockAction()` / `buildLifecycle()` 等工厂**

- [ ] **Step 4: 改写 10 个 `customBuild` 为组合调用**

- [ ] **Step 5: 跑 typecheck + 测试**

- [ ] **Step 6: Commit**

---

## Chunk 7: 最终校验

### Task 21: 跑全套 typecheck + 单测 + 格式化

- [ ] **Step 1: typecheck 全量**

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 2: 单测全量**

Run: `npm run test:unit`
Expected: 全部通过；若出现回归，定位到具体 Chunk 回滚或修复。

- [ ] **Step 3: 格式化**

Run: `npm run format && npm run check-format`
Expected: 无 diff（`npm run check-format` 0 错误）。

- [ ] **Step 4: 对比 `wc -l` 统计**

```bash
find src -name '*.ts' -exec wc -l {} + | tail -1
```

预期从原始 79,464 行降至约 77,000-77,600 行（消除 ~1800-2500 行）。

- [ ] **Step 5: 跑 `gitnexus_detect_changes` 检查影响面**

```
gitnexus_detect_changes({scope: 'all'})
```

确认改动集中在预期符号，无意外波及。

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "chore: final pass after code-simplifier refactor"
```

---

## 回归守护清单

每次 Chunk 完成后必须跑：

```bash
npm run typecheck
npm run check-format
npm run test:unit
```

涉及域：

| Chunk | 必跑测试 |
|---|---|
| 1 | `debugger/*.test.js`、`ToolRegistry.test.js` |
| 2 | `shared/pageResponse.test.js`、`debugger/*.test.js` |
| 3 | `debugger/*.test.js`、`debugger-tools.*.test.js` |
| 4 | `hook/*.test.js`、`jshook-tools.*.test.js`、`page/*.test.js`、`workflow/*.test.js`、`network/*.test.js` |
| 5 | `shared/response-builder.test.js` |
| 6 | `modules/deobfuscator/*.test.js`、`modules/hook/*.test.js`（若有） |
| 7 | `npm run test:unit` 全量 |

---

## 风险与回滚

- **Task 14（autoHook 数据驱动）** 与 **Task 18（resolver 数据驱动）** 改造面最大，若测试出现回归，用 `git revert <sha>` 单独回滚该 Task。
- **Task 20（HookTypeRegistry）** 标记为可选，时间紧可跳过。
- **Task 11（工具名冲突修复）** 属于 P0 但会改变 `name` 字段；若有外部脚本/文档引用旧名，需同步更新。
