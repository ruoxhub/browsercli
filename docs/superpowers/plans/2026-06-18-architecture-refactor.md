# Architecture Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically eliminate 4 categories of architectural debt (dead code, circular dependencies, god files, high fan-in) identified by GitNexus analysis.

**Architecture:** Four phases ordered by risk: dead code cleanup (lowest risk) → circular dependency resolution → god file splitting → high fan-in stabilization. Each phase is independently committable and testable.

**Tech Stack:** TypeScript ESM, node:test framework, Playwright/Patchright browser automation

**Spec:** `docs/superpowers/specs/2026-06-18-architecture-refactor-design.md`

---

## Scope Note

This plan covers Phases 1, 2, and 4 (well-scoped, low-to-medium risk). Phase 3 (god file splitting of 5 files totaling 5,211 lines) should be planned separately after Phase 2 is complete, since Phase 3d depends on Phase 2's `wrapFrameWithTimeout` extraction.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/formatters/consoleFormatter.ts` | Modify | Delete dead export `formatConsoleEventShort` |
| `src/formatters/networkFormatter.ts` | Modify | Delete dead exports `getFormattedHeaderValue`, `getFormattedRequestBody`; keep `getFormattedResponseBody` (used in tests) |
| `src/cli/tools-meta.ts` | Modify | Delete dead export `getToolArgSpecs` |
| `src/modules/analyzer/IntelligentAnalyzer.types.ts` | Modify | Add pattern types (`EncryptionPattern`, `SignaturePattern`, `TokenPattern`, `AntiDebugPattern`) moved from IntelligentAnalyzer.ts |
| `src/modules/analyzer/IntelligentAnalyzer.ts` | Modify | Remove pattern type definitions; update import path for types |
| `src/modules/analyzer/PatternDetector.ts` | Modify | Update type import path from IntelligentAnalyzer.ts to IntelligentAnalyzer.types.ts |
| `src/worker/timeoutUtils.ts` | Create | Extracted `wrapFrameWithTimeout` + `FRAME_EVALUATE_TIMEOUT` from ToolExecutionPipeline.ts |
| `src/worker/ToolExecutionPipeline.ts` | Modify | Remove `wrapFrameWithTimeout` + `FRAME_EVALUATE_TIMEOUT`; import from timeoutUtils.ts |
| `src/worker/ToolContext.ts` | Modify | Update `wrapFrameWithTimeout` import path |
| `src/tools/ToolDefinition.ts` | Modify | Add `@stable` JSDoc to `defineTool` |
| `src/runtime.ts` | Modify | Add `@stable` JSDoc to `Runtime` interface and `getRuntime` |
| `AGENTS.md` | Modify | Add high fan-in interface section |

---

## Phase 1: Dead Code Cleanup

### Task 1: Verify and delete confirmed dead exports

**Files:**
- Modify: `src/formatters/consoleFormatter.ts:27-32`
- Modify: `src/formatters/networkFormatter.ts:56-110`
- Modify: `src/cli/tools-meta.ts:282-287`
- Test: `tests/unit/formatters/console-network-formatters.test.ts` (verify `getFormattedResponseBody` test still passes)

> **Spec correction discovered during planning:** `getFormattedResponseBody` is imported by `tests/unit/formatters/console-network-formatters.test.ts:10` — it is NOT dead. Keep it. `loadToolMeta` in tools-meta.ts is NOT exported (internal function used at line 165) — it was a false positive. The truly dead exports are: `formatConsoleEventShort`, `getFormattedHeaderValue`, `getFormattedRequestBody`, `getToolArgSpecs` (4 functions, not 6).

- [ ] **Step 1: Run typecheck and tests to establish baseline**

Run: `npm run build && npm run typecheck && npm run test:unit`
Expected: All pass. This is the baseline before any deletions.

- [ ] **Step 2: Verify `formatConsoleEventShort` is truly dead**

Run: `grep -rn "formatConsoleEventShort" src/ tests/`
Expected: Only found in `src/formatters/consoleFormatter.ts` (definition) — no imports in src/ or tests/.

- [ ] **Step 3: Delete `formatConsoleEventShort` from consoleFormatter.ts**

In `src/formatters/consoleFormatter.ts`, delete lines 27-32:

```typescript
// The short format for a console message, based on a previous format.
export function formatConsoleEventShort(msg: ConsoleMessageData): string {
  if (msg.type === 'issue') {
    return `msgid=${msg.consoleMessageStableId} [${msg.type}] ${msg.message} (count: ${msg.count})`;
  }
  return `msgid=${msg.consoleMessageStableId} [${msg.type}] ${msg.message} (${msg.args?.length ?? 0} args)`;
}
```

- [ ] **Step 4: Verify `getFormattedHeaderValue` and `getFormattedRequestBody` are truly dead**

Run: `grep -rn "getFormattedHeaderValue\|getFormattedRequestBody" src/ tests/`
Expected: Only found in `src/formatters/networkFormatter.ts` (definitions) — no imports in src/ or tests/.

- [ ] **Step 5: Delete `getFormattedHeaderValue` and `getFormattedRequestBody` from networkFormatter.ts**

In `src/formatters/networkFormatter.ts`, delete lines 56-64:

```typescript
export function getFormattedHeaderValue(
  headers: Record<string, string>,
): string[] {
  const response: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    response.push(`- ${name}:${value}`);
  }
  return response;
}
```

And delete lines 98-110:

```typescript
export async function getFormattedRequestBody(
  httpRequest: HTTPRequest,
  sizeLimit: number = BODY_CONTEXT_SIZE_LIMIT,
): Promise<string | undefined> {
  // Playwright: no hasPostData()/fetchPostData(), use postData() directly
  const data = httpRequest.postData();

  if (data) {
    return `${getSizeLimitingString(data, sizeLimit)}`;
  }

  return;
}
```

Do NOT delete `getFormattedResponseBody` — it is used by `tests/unit/formatters/console-network-formatters.test.ts`.

- [ ] **Step 6: Verify `getToolArgSpecs` is truly dead**

Run: `grep -rn "getToolArgSpecs" src/ tests/`
Expected: Only found in `src/cli/tools-meta.ts` (definition at line 282) — no imports in src/ or tests/.

- [ ] **Step 7: Delete `getToolArgSpecs` from tools-meta.ts**

In `src/cli/tools-meta.ts`, delete lines 282-287:

```typescript
/**
 * 获取工具的参数规格（含 required / enum / defaultValue / description）
 */
export async function getToolArgSpecs(
  name: string,
): Promise<ToolArgSpecMap | undefined> {
  const meta = await getToolMetaAsync(name);
  return meta?.argSpecs;
}
```

- [ ] **Step 8: Run typecheck to verify no broken imports**

Run: `npm run build && npm run typecheck`
Expected: No errors. If any file imports the deleted functions, TypeScript will catch it here.

- [ ] **Step 9: Run tests to verify no regressions**

Run: `npm run test:unit`
Expected: All tests pass. Specifically `tests/unit/formatters/console-network-formatters.test.ts` still passes (it uses `getFormattedResponseBody` which was kept, and `formatConsoleEventVerbose` which was not deleted).

- [ ] **Step 10: Run format check**

Run: `npm run check-format`
Expected: No formatting issues.

- [ ] **Step 11: Commit**

```bash
git add src/formatters/consoleFormatter.ts src/formatters/networkFormatter.ts src/cli/tools-meta.ts
git commit -m "refactor: remove 4 dead exports identified by GitNexus analysis"
```

---

### Task 2: Verify and clean up "needs further confirmation" candidates

**Files:**
- Inspect: `src/browser/SessionManager.ts` — `remainingTags`
- Inspect: `src/config/schema.ts` — `GlobalConfigSchema`, `AIConfigSchema`, `booleanSchema`, `errorMap`

- [ ] **Step 1: Check `remainingTags` in SessionManager.ts**

Run: `grep -n "remainingTags" src/browser/SessionManager.ts`

If it's a local variable inside a function (not an exported function), it's a GitNexus false positive — skip it.
If it's an exported function with no imports elsewhere, delete it.

- [ ] **Step 2: Check schema.ts exports**

Run: `grep -rn "GlobalConfigSchema\|AIConfigSchema\|booleanSchema" src/ tests/ | grep -v "src/config/schema.ts"`

If these Zod schemas are imported by other files (e.g., `src/config/resolver.ts` or test files), they are NOT dead — skip.
If they are only defined in schema.ts and never imported elsewhere, delete them.

- [ ] **Step 3: Run typecheck after any deletions**

Run: `npm run build && npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: All pass.

- [ ] **Step 5: Commit (only if deletions were made)**

```bash
git add -A
git commit -m "refactor: remove additional dead code from GitNexus candidate list"
```

If no deletions were made, skip this step.

---

## Phase 2: Circular Dependency Resolution

### Task 3: Break IntelligentAnalyzer ↔ PatternDetector type cycle

**Background:** `PatternDetector.ts` imports 4 pattern types (`AntiDebugPattern`, `EncryptionPattern`, `SignaturePattern`, `TokenPattern`) from `IntelligentAnalyzer.ts`, while `IntelligentAnalyzer.ts` imports 9 detect/filter functions from `PatternDetector.ts`. This creates a mixed cycle (value + type).

**Fix:** Move the 4 pattern type definitions from `IntelligentAnalyzer.ts` (lines 54-82) to the existing `IntelligentAnalyzer.types.ts` file. Both files then import types from the shared types file, breaking the cycle.

**Files:**
- Modify: `src/modules/analyzer/IntelligentAnalyzer.types.ts` — add 4 pattern types
- Modify: `src/modules/analyzer/IntelligentAnalyzer.ts` — remove type definitions, import from .types.ts
- Modify: `src/modules/analyzer/PatternDetector.ts` — update import path

- [ ] **Step 1: Read current pattern type definitions**

In `src/modules/analyzer/IntelligentAnalyzer.ts`, note the exact definitions at lines 54-82:

```typescript
export interface EncryptionPattern {
  type: string;
  algorithm?: string;
  key?: string;
  iv?: string;
  location: string;
  confidence: number;
}

export interface SignaturePattern {
  type: string;
  headerName?: string;
  paramName?: string;
  location: string;
  confidence: number;
  details?: string;
}

export interface TokenPattern {
  type: string;
  paramName?: string;
  location: string;
  confidence: number;
  details?: string;
}

export interface AntiDebugPattern {
  type: string;
  technique: string;
  location: string;
  confidence: number;
  details?: string;
}
```

Verify these exact definitions by reading the file — line numbers may have shifted.

- [ ] **Step 2: Add pattern types to IntelligentAnalyzer.types.ts**

Append to the end of `src/modules/analyzer/IntelligentAnalyzer.types.ts`:

```typescript
export interface EncryptionPattern {
  type: string;
  algorithm?: string;
  key?: string;
  iv?: string;
  location: string;
  confidence: number;
}

export interface SignaturePattern {
  type: string;
  headerName?: string;
  paramName?: string;
  location: string;
  confidence: number;
  details?: string;
}

export interface TokenPattern {
  type: string;
  paramName?: string;
  location: string;
  confidence: number;
  details?: string;
}

export interface AntiDebugPattern {
  type: string;
  technique: string;
  location: string;
  confidence: number;
  details?: string;
}
```

- [ ] **Step 3: Remove pattern type definitions from IntelligentAnalyzer.ts and add re-export**

In `src/modules/analyzer/IntelligentAnalyzer.ts`:

1. Expand the existing import from the types file (lines 15-20) to include the 4 pattern types:

```typescript
import type {
  AnalyzerConsoleMessage,
  AnalyzerExceptionInfo,
  AnalyzerNetworkRequest,
  AnalyzerNetworkResponse,
} from './IntelligentAnalyzer.types.js';

import {
  type AntiDebugPattern,
  type EncryptionPattern,
  type SignaturePattern,
  type TokenPattern,
} from './IntelligentAnalyzer.types.js';
```

Use regular `import` (not `import type`) for the pattern types so they can be re-exported below. The `type` keyword before each name ensures they are still type-only at the value level.

2. Delete the 4 interface definitions (the ones copied to types.ts in Step 2).

3. Add re-exports so existing consumers that import these types from IntelligentAnalyzer.ts still work:

```typescript
export {
  type AntiDebugPattern,
  type EncryptionPattern,
  type SignaturePattern,
  type TokenPattern,
} from './IntelligentAnalyzer.types.js';
```

- [ ] **Step 4: Update PatternDetector.ts import path**

In `src/modules/analyzer/PatternDetector.ts`, change lines 13-18:

From:
```typescript
import type {
  AntiDebugPattern,
  EncryptionPattern,
  SignaturePattern,
  TokenPattern,
} from './IntelligentAnalyzer.js';
```

To:
```typescript
import type {
  AntiDebugPattern,
  EncryptionPattern,
  SignaturePattern,
  TokenPattern,
} from './IntelligentAnalyzer.types.js';
```

This breaks the circular dependency: PatternDetector no longer imports from IntelligentAnalyzer.

- [ ] **Step 5: Run typecheck**

Run: `npm run build && npm run typecheck`
Expected: No errors. The `export type` re-exports in IntelligentAnalyzer.ts ensure backward compatibility for any other files that import these types from IntelligentAnalyzer.

- [ ] **Step 6: Run tests**

Run: `npm run test:unit`
Expected: All pass.

- [ ] **Step 7: Verify the cycle is broken**

Run: `grep -n "from.*IntelligentAnalyzer\.js" src/modules/analyzer/PatternDetector.ts`
Expected: No output (PatternDetector no longer imports from IntelligentAnalyzer.js).

Run: `grep -n "from.*PatternDetector\.js" src/modules/analyzer/IntelligentAnalyzer.ts`
Expected: Still shows the function imports (this direction is fine — it's now unidirectional).

- [ ] **Step 8: Commit**

```bash
git add src/modules/analyzer/IntelligentAnalyzer.types.ts src/modules/analyzer/IntelligentAnalyzer.ts src/modules/analyzer/PatternDetector.ts
git commit -m "refactor(analyzer): break IntelligentAnalyzer-PatternDetector circular dependency

Move 4 pattern type definitions (EncryptionPattern, SignaturePattern,
TokenPattern, AntiDebugPattern) from IntelligentAnalyzer.ts to
IntelligentAnalyzer.types.ts. PatternDetector now imports types from
the shared types file instead of IntelligentAnalyzer, eliminating
the mixed value+type circular dependency."
```

---

### Task 4: Break ToolContext ↔ ToolExecutionPipeline value cycle

**Background:** `ToolContext.ts` imports `wrapFrameWithTimeout` (value) from `ToolExecutionPipeline.ts`, while `ToolExecutionPipeline.ts` imports types (`DefineToolContextFactory`, `ToolContextProvider`) from `ToolContext.ts`. This creates a mixed cycle.

**Fix:** Extract `wrapFrameWithTimeout` and its constant `FRAME_EVALUATE_TIMEOUT` to a new `src/worker/timeoutUtils.ts` file.

**Files:**
- Create: `src/worker/timeoutUtils.ts`
- Modify: `src/worker/ToolExecutionPipeline.ts` — remove function, re-export from new file
- Modify: `src/worker/ToolContext.ts` — update import path

- [ ] **Step 1: Create `src/worker/timeoutUtils.ts`**

Create the file with the extracted function:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from 'patchright';

export const FRAME_EVALUATE_TIMEOUT = 10_000;

export function wrapFrameWithTimeout(
  frame: Frame,
  timeoutMs: number = FRAME_EVALUATE_TIMEOUT,
): Frame {
  return new Proxy(frame, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'evaluate') {
        return function evaluateWithTimeout(this: unknown, ...args: unknown[]) {
          const evalPromise = (value as (...args: unknown[]) => unknown).apply(
            target,
            args,
          );
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `frame.evaluate() 超时 (${timeoutMs}ms)，可能调试器已断开`,
                  ),
                ),
              timeoutMs,
            ),
          );
          return Promise.race([evalPromise, timeoutPromise]);
        };
      }
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}
```

- [ ] **Step 2: Update ToolExecutionPipeline.ts**

In `src/worker/ToolExecutionPipeline.ts`:

1. Delete `FRAME_EVALUATE_TIMEOUT` constant (line 71) and `wrapFrameWithTimeout` function (lines 73-106).

2. Delete the `import type {Frame} from 'patchright';` import (line 7) — it was only used by `wrapFrameWithTimeout`.

3. Add re-export for backward compatibility:

```typescript
export {wrapFrameWithTimeout, FRAME_EVALUATE_TIMEOUT} from './timeoutUtils.js';
```

4. Add internal import since `ToolExecutionRouter` (line 149) uses `wrapFrameWithTimeout`:

```typescript
import {wrapFrameWithTimeout} from './timeoutUtils.js';
```

- [ ] **Step 3: Update ToolContext.ts import**

In `src/worker/ToolContext.ts`, change line 47:

From:
```typescript
import {wrapFrameWithTimeout} from './ToolExecutionPipeline.js';
```

To:
```typescript
import {wrapFrameWithTimeout} from './timeoutUtils.js';
```

- [ ] **Step 4: Run typecheck**

Run: `npm run build && npm run typecheck`
Expected: No errors. The re-export in ToolExecutionPipeline.ts ensures any other files importing `wrapFrameWithTimeout` from there still work.

- [ ] **Step 5: Run tests**

Run: `npm run test:unit`
Expected: All pass.

- [ ] **Step 6: Verify the cycle is broken**

Run: `grep -n "from.*ToolExecutionPipeline" src/worker/ToolContext.ts`
Expected: No output (ToolContext no longer imports from ToolExecutionPipeline).

Run: `grep -n "from.*ToolContext" src/worker/ToolExecutionPipeline.ts`
Expected: Still shows type imports (this direction is fine — now unidirectional).

- [ ] **Step 7: Commit**

```bash
git add src/worker/timeoutUtils.ts src/worker/ToolExecutionPipeline.ts src/worker/ToolContext.ts
git commit -m "refactor(worker): break ToolContext-ToolExecutionPipeline circular dependency

Extract wrapFrameWithTimeout and FRAME_EVALUATE_TIMEOUT from
ToolExecutionPipeline.ts to new timeoutUtils.ts. ToolContext now
imports from timeoutUtils instead of ToolExecutionPipeline,
eliminating the mixed value+type circular dependency."
```

---

## Phase 4: High Fan-in Interface Stabilization

### Task 5: Add @stable annotations and AGENTS.md documentation

**Files:**
- Modify: `src/tools/ToolDefinition.ts` — add `@stable` JSDoc
- Modify: `src/runtime.ts` — add `@stable` JSDoc
- Modify: `AGENTS.md` — add high fan-in section

- [ ] **Step 1: Add @stable to defineTool in ToolDefinition.ts**

Find the `defineTool` function definition in `src/tools/ToolDefinition.ts` and add/update its JSDoc:

```typescript
/**
 * 定义 MCP 工具的工厂函数。
 *
 * @stable 此函数被 102+ 个工具文件调用。修改签名前必须运行 impact 分析。
 * 扩展参数时使用可选属性或 Partial<>，不要修改必选参数。
 */
export function defineTool<...>(...): ToolDefinition {
```

- [ ] **Step 2: Add @stable to Runtime interface and getRuntime in runtime.ts**

In `src/runtime.ts`, add JSDoc to the `Runtime` interface:

```typescript
/**
 * 运行时服务集合。所有 MCP 工具通过 getRuntime() 访问共享服务。
 *
 * @stable 此接口被 57+ 个文件消费。新增服务应通过 RuntimeServices lazy getter 暴露，
 * 而不是直接添加到此接口。修改字段前必须运行 impact 分析。
 */
export interface Runtime {
```

And add JSDoc to `getRuntime`:

```typescript
/**
 * 获取全局运行时实例。
 *
 * @stable 高扇入函数（57+ 调用方）。修改返回类型前必须运行 impact 分析。
 */
export function getRuntime(): Runtime {
```

- [ ] **Step 3: Add high fan-in section to AGENTS.md**

In `AGENTS.md`, after the "### 核心运行时组件" section, add:

```markdown
### 高扇入接口（@stable）

以下函数/接口被大量调用方依赖，修改签名或返回类型前**必须**运行 impact 分析。
扩展时使用可选属性或 `Partial<>`，不要修改必选参数。

| 符号 | 文件 | 调用方数 | 说明 |
|------|------|---------|------|
| `defineTool` | `src/tools/ToolDefinition.ts` | 102+ | 工具定义工厂，所有 MCP 工具通过此注册 |
| `Runtime` | `src/runtime.ts` | 57+ | 运行时服务接口，新增服务应走 `RuntimeServices` lazy getter |
| `getRuntime` | `src/runtime.ts` | 57+ | 全局运行时访问器 |
| `safeStringify` | `src/utils/safeJson.ts` | 16 | JSON 安全序列化 |
| `getEnvValue` | `src/config/resolver.ts` | 11 | 环境变量读取 |
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/ToolDefinition.ts src/runtime.ts AGENTS.md
git commit -m "docs: add @stable annotations to high fan-in interfaces

Mark defineTool (102+ callers), Runtime interface (57+ consumers),
and getRuntime (57+ callers) as @stable. Document high fan-in
interfaces in AGENTS.md for contributor awareness."
```

---

## Final Verification

### Task 6: Full regression and GitNexus re-analysis

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run full unit test suite**

Run: `npm run test:unit`
Expected: All tests pass

- [ ] **Step 3: Run format check**

Run: `npm run check-format`
Expected: No formatting issues

- [ ] **Step 4: Rebuild GitNexus index and verify improvements**

Run: `npx gitnexus analyze --force`
Expected: Index rebuilds successfully.

Then verify circular dependencies are resolved:
```bash
grep -rn "from.*IntelligentAnalyzer\.js" src/modules/analyzer/PatternDetector.ts
grep -rn "from.*ToolExecutionPipeline" src/worker/ToolContext.ts
```
Expected: Both produce no output (cycles broken).

- [ ] **Step 5: Final commit (only if fixups needed)**

```bash
git add -A
git commit -m "chore: final fixups from architecture refactoring verification"
```
