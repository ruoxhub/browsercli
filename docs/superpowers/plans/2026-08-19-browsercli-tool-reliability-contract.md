# BrowserCLI 全工具可靠性与契约一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `defineTool -> ToolExecutionPipeline -> ToolAdapter -> HTTP Job` 链路上实现声明式运行需求、暂停态快速失败、严格参数契约、AI 自动本地降级、失败 Job 语义以及三层验证门禁。

**Architecture:** 继续以 `defineTool` 和生成的 `ToolMeta` 为唯一工具契约，不建立第二套注册中心。基础状态判断集中在 `ToolPrerequisiteChecker` 和 `ToolExecutionPipeline`，工具 handler 只负责业务；所有失败通过 `ToolError` 传播到 `JobStore.fail`，AI 增强失败时返回带执行元数据的本地分析结果。

**Tech Stack:** TypeScript 5.9 ESM、Node.js `^20.19.0 || ^22.12.0 || >=23`、Zod、Patchright/CDP、Node `node:test`、SWC、独立 `browsercli/` TypeScript 包。

**Spec:** `docs/superpowers/specs/2026-08-19-browsercli-tool-reliability-contract-design.md`

## Global Constraints

- 不新增依赖；使用现有 Zod、Node 标准库、Patchright 和测试工具。
- 不建立第二套工具注册表；Schema 及 `defineTool` 生成元数据仍是唯一事实源。
- `defineTool` 高扇入接口只能增加可选属性，不修改现有必选字段或 handler 签名。
- 参数别名立即移除，不提供兼容期或静默转换；工具名称 aliases 不在本次范围内。
- 暂停态检查只读取已存在 Debugger 状态，不 eager-enable CDP 域，不自动 `resume`。
- 工具失败必须 reject 并令 Job 进入 `failed`；禁止通过成功响应携带失败状态。
- AI 未配置或不可用时优先返回确定性本地分析；本地不能满足核心语义时才返回 `AI_REQUIRED`。
- 浏览器验证只访问仓库内本地 fixture，不访问生产站点，不写入真实 Cookie 或凭据。
- 实施期间不自动创建 Git commit；只有用户明确要求时才提交。
- 每个任务完成后运行变更文件诊断、最小测试和该任务列出的验证命令。

## File Responsibility Map

| 文件/目录                                            | 本计划中的职责                                          |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `src/utils/errors.ts`                                | 唯一工具错误模型、错误码、恢复信息与序列化              |
| `src/tools/ToolDefinition.ts`                        | 声明可选 `ToolRuntimeRequirements`                      |
| `src/tools/manifest.ts`                              | 将声明式要求挂接到每个注册条目                          |
| `src/tools/registry/ToolRegistry.ts`                 | 把 manifest 条目要求传给 `ToolMeta`                     |
| `src/tools/tools-meta.ts`                            | 生成 Worker/CLI 共享的工具契约                          |
| `browsercli/src/tool-meta-types.ts`                  | Worker 契约的远程只读镜像                               |
| `src/tools/prerequisites/ToolPrerequisiteChecker.ts` | 唯一运行环境门禁                                        |
| `src/worker/ToolExecutionPipeline.ts`                | 固定验证顺序、错误记录与 handler 调度                   |
| `src/tools/tool-arg-validator.ts`                    | 严格规范参数验证，不执行别名转换                        |
| `browsercli/src/commands/shared/tool-args.ts`        | 严格 CLI 值解析与 JSON 输入                             |
| `src/services/AIService.ts`                          | 有界 AI 请求、取消、错误分类                            |
| `src/tools/analyzer/`                                | 本地结果与可选 AI 增强的统一响应                        |
| `src/web/routes/apiV1.ts` / `src/worker/JobStore.ts` | Job 终态和结构化错误传输                                |
| `scripts/verify-skills-schema.ts`                    | 文档示例与 Schema 的自动一致性门禁                      |
| `tests/unit/`                                        | 全工具离线契约和组件行为                                |
| `tests/integration/`                                 | 按领域运行的确定性集成验证                              |
| `tests/fixtures/browsercli-reliability/`             | 高风险真实浏览器测试页、脚本、Wasm 和 WebSocket fixture |

## Dependency Waves

```text
Wave 1: Task 1 Error model || Task 2 Runtime requirements
Wave 2: Task 3 Pipeline guards || Task 4 Strict arguments || Task 5 AI fallback
Wave 3: Task 6 Handler/Job migration || Task 7 Docs/CLI contract gate
Wave 4: Task 8 Three-layer verification and final closure
```

---

### Task 1: 扩展统一 ToolError 与恢复信息

**Files:**

- Modify: `src/utils/errors.ts`
- Modify: `browsercli/src/WorkerHttpClient.ts`
- Test: `tests/unit/utils/errors.test.ts`
- Test: `browsercli/tests/unit/WorkerHttpClient.test.ts`

**Interfaces:**

- Consumes: 现有 `ErrorCodes`, `ToolError`, `createToolError`, `formatError`。
- Produces: `ToolRecovery`, `ToolErrorOptions`, 扩展后的 `ErrorResponse` 与 `JobStatus.error`。

- [ ] **Step 1: 先做高扇入影响检查**

Run:

```bash
git diff -- src/utils/errors.ts browsercli/src/WorkerHttpClient.ts
```

Then run the repository impact query for `ErrorCodes`, `ToolError`, `createToolError`, and `formatError`. Record callers that construct `ToolError` positionally; the implementation must retain the existing first three constructor arguments.

- [ ] **Step 2: 写失败测试，锁定错误码、默认重试性和恢复信息**

Add assertions to `tests/unit/utils/errors.test.ts` equivalent to:

```typescript
const error = createToolError(
  ErrorCodes.DEBUGGER_PAUSED,
  'Page execution is paused',
  {toolName: 'click'},
  {
    retryable: true,
    recovery: {
      tool: 'resume',
      command: 'browsercli call resume',
      reason: 'Resume execution or evaluate the current call frame.',
    },
  },
);

assert.equal(error.retryable, true);
assert.equal(error.recovery?.tool, 'resume');
assert.deepEqual(formatError(error), {
  code: 'DEBUGGER_PAUSED',
  type: 'ToolError',
  message: 'Page execution is paused',
  context: {toolName: 'click'},
  retryable: true,
  recovery: {
    tool: 'resume',
    command: 'browsercli call resume',
    reason: 'Resume execution or evaluate the current call frame.',
  },
});
```

Add a table test asserting default `retryable === false` for `VALIDATION`, `NOT_FOUND`, `PERMISSION`, and `NATIVE_TOOL_MISSING`.

- [ ] **Step 3: 编译并确认测试失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/utils/errors.test.js
```

Expected: compile or test failure because new error codes/options do not exist.

- [ ] **Step 4: 最小扩展 `src/utils/errors.ts`**

Add these public shapes without removing the existing `context` field:

```typescript
export interface ToolRecovery {
  tool?: string;
  command?: string;
  reason: string;
}

export interface ToolErrorOptions {
  retryable?: boolean;
  recovery?: ToolRecovery;
  details?: Record<string, unknown>;
}
```

Add canonical codes `BROWSER_REQUIRED`, `PAGE_REQUIRED`, `FRAME_REQUIRED`,
`DEBUGGER_PAUSED`, `DEBUGGER_NOT_PAUSED`, `NATIVE_TOOL_MISSING`, and
`AI_REQUIRED`. Keep existing `SCRIPT_ID_STALE` and `PAGE_UNRESPONSIVE` names.

Change `ToolError` so its first three arguments remain `(code, message, context?)`,
with `options?: ToolErrorOptions` as the fourth argument. Preserve a deprecated
read-only `recoverable` getter only if existing callers/tests require it, mapping it
to `retryable`; do not store two independent booleans.

- [ ] **Step 5: 扩展 HTTP Job 错误镜像**

In `browsercli/src/WorkerHttpClient.ts`, change `JobStatus.error` to:

```typescript
error?: {
  code: string;
  message: string;
  retryable?: boolean;
  recovery?: ToolRecovery;
  details?: Record<string, unknown>;
};
```

Import or duplicate only the transport shape in `browsercli/`; do not import Worker source into the standalone CLI package.

- [ ] **Step 6: 验证 Task 1**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/utils/errors.test.js
npm --prefix browsercli test
```

Expected: all commands exit 0.

---

### Task 2: 建立声明式工具运行需求并传播到 ToolMeta

**Files:**

- Modify: `src/tools/ToolDefinition.ts`
- Modify: `src/tools/manifest.ts`
- Modify: `src/tools/registry/ToolRegistry.ts`
- Modify: `src/tools/tools-meta.ts`
- Modify: `browsercli/src/tool-meta-types.ts`
- Modify: selected `src/tools/*/manifest.ts`
- Test: `tests/unit/tools/ToolDefinition.extended.test.ts`
- Test: `tests/unit/tools/ToolRegistry.test.ts`
- Test: `tests/unit/tools/profile-coverage.test.ts`
- Test: `browsercli/tests/unit/help.test.ts`

**Interfaces:**

- Consumes: 现有 `ToolDefinition.annotations`, `ToolEntry`, `RegisteredToolEntry`, `ToolMeta`。
- Produces:

```typescript
export interface ToolRuntimeRequirements {
  browser?: 'connected';
  page?: 'selected';
  frame?: 'selected';
  debugger?: 'available' | 'paused' | 'running';
  ai?: 'optional' | 'required';
  nativeTools?: string[];
  recovery?: boolean;
}
```

- [ ] **Step 1: 写失败测试，验证可选属性和元数据传播**

In `tests/unit/tools/ToolDefinition.extended.test.ts`, define a fixture with:

```typescript
annotations: {
  category: ToolCategory.INPUT,
  readOnlyHint: false,
  requirements: {
    browser: 'connected',
    page: 'selected',
    frame: 'selected',
    debugger: 'running',
  },
}
```

Assert the fixture still satisfies `ToolDefinition` and that a ToolDefinition without
`requirements` remains valid.

In `tests/unit/tools/ToolRegistry.test.ts`, build a manifest entry with requirements
and assert `listTools('full')[0].requirements` is preserved.

- [ ] **Step 2: 确认测试失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/ToolDefinition.extended.test.js build/tests/unit/tools/ToolRegistry.test.js
```

Expected: type/build failure because `requirements` is unknown.

- [ ] **Step 3: 增加可选类型并贯穿注册链**

Add `requirements?: ToolRuntimeRequirements` to `ToolDefinition.annotations` and
`ToolEntry`. Propagate it through `RegisteredToolEntry`, `ToolRegistryEntry`,
`ToolMeta`, `loadToolMeta`, `buildMinimalMeta`, and the standalone CLI mirror.

Use entry-level requirements as the canonical declaration. During migration,
`loadToolMeta` must reject conflicting `ToolEntry.requirements` and
`ToolDefinition.annotations.requirements` rather than silently choose one. The
end state is one matching value exposed through `/api/v1/tools`.

- [ ] **Step 4: 迁移首批代表工具元数据**

Declare requirements for these representative paths first:

- `click`: browser/page/frame/debugger running.
- `list_scripts`: browser/page/debugger available.
- `evaluate_on_callframe`: browser/page/debugger paused.
- `resume`: browser/page/debugger available, recovery true.
- `check_browser_health`: browser connected, recovery true.
- `wasm_disassemble`: native tool requirements only where the implementation truly requires an external binary.

Do not annotate all tools by inference in this step; the full coverage test in Task 8 will drive the remaining manifest entries.

- [ ] **Step 5: 验证 Worker 和 CLI 元数据**

Run:

```bash
npm run build
npm run test:registry
npm --prefix browsercli test
```

Expected: metadata tests pass and CLI help can render tools with or without requirements.

---

### Task 3: 集中实现前置条件和 Debugger 暂停态快速失败

**Files:**

- Modify: `src/tools/prerequisites/ToolPrerequisiteChecker.ts`
- Modify: `src/worker/ToolExecutionPipeline.ts`
- Modify: `src/worker/ToolContext.ts`
- Modify: `src/modules/debugger/DebuggerManager.ts` only if a read-only state accessor is absent
- Test: `tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.ts`
- Test: `tests/unit/worker/ToolExecutionPipeline.test.ts`
- Test: `tests/unit/worker/DebuggerContextProvider.test.ts`

**Interfaces:**

- Consumes: `ToolRuntimeRequirements`, Task 1 error codes, existing `PageHealthTracker`, `Context.getExistingDebuggerContext()`.
- Produces: `ToolPrerequisiteChecker.check(toolName, requirements)` that throws before handler invocation.

- [ ] **Step 1: 写 checker 状态矩阵失败测试**

Create `tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.ts` with table cases:

| State              | Requirement       | Expected                                |
| ------------------ | ----------------- | --------------------------------------- |
| no browser context | browser connected | `BROWSER_REQUIRED`                      |
| no page            | page selected     | `PAGE_REQUIRED`                         |
| no frame           | frame selected    | `FRAME_REQUIRED`                        |
| paused             | debugger running  | `DEBUGGER_PAUSED`, recovery `resume`    |
| running            | debugger paused   | `DEBUGGER_NOT_PAUSED`, recovery `pause` |
| unresponsive page  | recovery false    | `PAGE_UNRESPONSIVE`                     |
| unresponsive page  | recovery true     | allowed                                 |

The mock debugger must expose a synchronous read-only method returning whether a
paused state exists. Assert no mock method that enables Debugger/Runtime is called.

- [ ] **Step 2: 写 Pipeline 快速失败测试**

Extend `tests/unit/worker/ToolExecutionPipeline.test.ts`:

```typescript
const startedAt = performance.now();
await assert.rejects(
  pipeline.execute(meta({requirements: {debugger: 'running'}}), {}),
  (error: unknown) =>
    error instanceof ToolError && error.code === ErrorCodes.DEBUGGER_PAUSED,
);
assert.ok(performance.now() - startedAt < 250);
assert.equal(routerExecuteCalls, 0);
```

Also assert the checker runs after parameter validation but before handler loading,
matching the approved order.

- [ ] **Step 3: 确认测试失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.js build/tests/unit/worker/ToolExecutionPipeline.test.js
```

- [ ] **Step 4: 扩展 checker context，禁止隐式初始化**

The checker context must expose only state-safe accessors:

```typescript
interface ToolPrerequisiteContext {
  getBrowserContext(): unknown | null;
  getSelectedPage(): unknown | null;
  getSelectedFrame(): unknown | null;
  getSelectedPageId(): string | undefined;
  getExistingDebuggerContext(): DebuggerManager | undefined;
}
```

Do not call `getDebuggerContext()` from the checker. Determine paused state from
the existing manager's stored paused state (`getPausedState() !== null`) or an
equivalent existing read-only accessor.

- [ ] **Step 5: 将页面健康白名单替换为元数据**

Remove `RECOVERY_TOOL_NAMES` from `ToolExecutionPipeline.ts`. Move the current
`PAGE_UNRESPONSIVE` logic into `ToolPrerequisiteChecker`, allowing execution only
when `requirements.recovery === true`.

Keep `PageHealthTracker` behavior unchanged. A successful recovery tool may reset
health only after real success.

- [ ] **Step 6: 验证 Task 3**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --test build/tests/unit/tools/prerequisites/ToolPrerequisiteChecker.test.js build/tests/unit/worker/ToolExecutionPipeline.test.js build/tests/unit/worker/DebuggerContextProvider.test.js
```

Expected: paused tools fail under 250ms, paused-only tools run only while paused,
and no test observes eager debugger activation.

---

### Task 4: 删除参数别名并严格对齐 Worker 与 CLI 解析

**Files:**

- Modify: `src/tools/tool-arg-validator.ts`
- Modify: `src/tools/tool-aliases.ts`
- Modify: `browsercli/src/commands/shared/tool-args.ts`
- Test: `tests/unit/tools/tool-arg-validator.test.ts`
- Test: `browsercli/tests/unit/tool-dispatcher.test.ts`
- Test: `browsercli/tests/unit/args-parser.test.ts`

**Interfaces:**

- Consumes: `ToolMeta.argSpecs`, `suggestSimilarKeys`。
- Produces: exact-key validation and JSON-only complex argument parsing.

- [ ] **Step 1: 写 Worker 严格参数失败测试**

Add cases proving:

- `get_dom_structure --depth 2` is rejected and suggests `maxDepth`.
- `get_dom_structure --maxDepth 2` succeeds.
- An unknown key is rejected even if it exists in `tool-aliases.ts` today.
- `string[]` rejects a scalar string.
- Enum error lists all accepted case-sensitive values.

- [ ] **Step 2: 写 CLI 复杂参数测试**

In `browsercli/tests/unit/tool-dispatcher.test.ts`, assert:

```typescript
buildToolArgs(parseArgs(['--events', '["click","submit"]']), {
  events: {type: 'string[]', required: true, description: ''},
});
```

returns `{events: ['click', 'submit']}`, while `--events click,submit` remains the
literal string and is rejected by the Worker validator. Assert `--data` and
`--file` continue accepting JSON objects.

- [ ] **Step 3: 确认测试失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/tool-arg-validator.test.js
npm --prefix browsercli test
```

- [ ] **Step 4: 移除参数别名归一化**

Delete `getAliasesForTool` usage, `buildAliasMap`, and alias rewriting from
`tool-arg-validator.ts`. Retain `suggestSimilarKeys` only for messages.

If `src/tools/tool-aliases.ts` also stores tool-name aliases, preserve that section;
remove only parameter alias data and exports. No compatibility warning is emitted
because aliases are immediately unsupported by approved decision.

- [ ] **Step 5: 禁止 CLI 逗号隐式拆数组**

In `inferArgValue`, for `string[]`, parse only a valid JSON array literal. Return
the original scalar otherwise so the Worker produces canonical `VALIDATION`.

- [ ] **Step 6: 验证 Task 4**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --test build/tests/unit/tools/tool-arg-validator.test.js
npm --prefix browsercli test
```

---

### Task 5: 实现有界 AI 调用和自动本地降级

**Files:**

- Modify: `src/services/AIService.ts`
- Modify: `src/services/LLMService.ts` only where signal/budget propagation requires it
- Modify: `src/config/servicesConfig.ts`
- Modify: `src/runtime/RuntimeServices.ts`
- Modify: `src/tools/analyzer/understand.ts`
- Modify: `src/tools/analyzer/summarize.ts`
- Modify: `src/tools/analyzer/analyzeTarget.ts`
- Modify: `src/tools/analyzer/riskPanel.ts`
- Create: `src/tools/analyzer/analysisExecution.ts`
- Test: `tests/unit/services/AIService.test.ts`
- Test: `tests/property/AIService.property.test.ts`
- Test: `tests/unit/tools/jshook-tools.handlers.test.ts`
- Test: `tests/unit/tools/reverse-task-tools.test.ts`

**Interfaces:**

- Produces:

```typescript
export interface AnalysisExecutionMeta {
  analysisMode: 'ai' | 'local';
  fallbackReason?: 'not_configured' | 'unavailable' | 'timeout';
}
```

- [ ] **Step 1: 写 AIService 有界行为失败测试**

Add tests for:

1. Unconfigured provider: zero provider calls and zero sleeps.
2. Provider success: result returned with no fallback.
3. Provider timeout: abort occurs within configured budget.
4. Retryable network error: retries stop when total budget expires.
5. Caller AbortSignal: pending provider and retry sleep are cancelled.

Use injected fake timers/provider functions; tests must not access a real API.

- [ ] **Step 2: 写四个分析工具降级契约测试**

For `understand_code`, `summarize_code`, `analyze_target`, and `risk_panel`, assert
that an unconfigured AI service returns a real local result with:

```typescript
meta: {
  analysisMode: 'local',
  fallbackReason: 'not_configured',
}
```

and does not return `success: false`. `analyze_target` must still perform its
local collector/crypto/static steps; provide mocks for browser-dependent parts.

- [ ] **Step 3: 确认测试失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/services/AIService.test.js build/tests/unit/tools/jshook-tools.handlers.test.js build/tests/unit/tools/reverse-task-tools.test.js
```

- [ ] **Step 4: 实现 AI 可用性和预算接口**

Do not require every provider to perform a network health probe. Expose
configuration availability from `servicesConfig`/`RuntimeServices`, and pass an
`AbortSignal` plus deadline into `AIService.withRetry`.

Use an internal result classification:

```typescript
type AIAvailability =
  | {available: true}
  | {available: false; reason: 'not_configured'};
```

Classify thrown timeout/connection errors into `timeout` or `unavailable` for
fallback metadata. Ensure retry sleeps race with AbortSignal.

- [ ] **Step 5: 新建本地优先分析协调器**

`src/tools/analyzer/analysisExecution.ts` should export one focused helper that
accepts a local analysis callback and optional AI enrichment callback. It returns
the local result merged with `AnalysisExecutionMeta`, and never hides a local
analysis exception.

AI exceptions trigger local fallback only after local analysis has succeeded.
When a tool has no meaningful local implementation and declares `ai: 'required'`,
throw `AI_REQUIRED` with a configuration recovery command.

- [ ] **Step 6: 迁移四个工具**

Remove redundant manual required-parameter branches already guaranteed by Zod
(for example `analyze_target`'s `if (!params.url)` success-false branch). Run local
analysis first, then optional AI enrichment, and include `meta` at a consistent
top-level location inside `structuredContent`.

- [ ] **Step 7: 验证 Task 5**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --test build/tests/unit/services/AIService.test.js build/tests/property/AIService.property.test.js build/tests/unit/tools/jshook-tools.handlers.test.js build/tests/unit/tools/reverse-task-tools.test.js
```

Expected: no external network, no unbounded timer, and all local fallback assertions pass.

---

### Task 6: 迁移 handler 失败语义并保证 Job failed

**Files:**

- Modify: `src/worker/ToolResponse.ts`
- Modify: `src/worker/JobStore.ts`
- Modify: `src/web/routes/apiV1.ts`
- Modify: `browsercli/src/WorkerHttpClient.ts`
- Modify: error branches under `src/tools/`
- Create: `tests/unit/tools/tool-failure-contract.test.ts`
- Test: `tests/unit/web/JobStore.test.ts`
- Test: `tests/unit/web/routes/apiV1.test.ts`
- Test: `tests/unit/worker/ToolResponseProcessor.test.ts`
- Test: `browsercli/tests/unit/jobs.test.ts`

**Interfaces:**

- Consumes: Task 1 `ToolError` transport and Task 3 guards.
- Produces: no `done` Job can contain a tool failure response.

- [ ] **Step 1: 建立精确迁移清单**

Run:

```bash
rg -n "success:\s*false|setStructuredContent.*error|message:.*失败|message:.*错误" src/tools
```

Store the categorized inventory in the test fixture, not a generated production
file. Classify each branch as:

- expected empty/not-found data that is still a successful query;
- parameter/precondition failure already handled centrally;
- runtime/dependency failure that must throw `ToolError`.

Do not transform based only on message text.

- [ ] **Step 2: 写失败响应检测测试**

Create `tests/unit/tools/tool-failure-contract.test.ts` that loads all definitions
and statically scans tool source paths for prohibited result shapes. The test may
temporarily allow a checked-in explicit allowlist of known migration files; each
domain batch below must shrink it. Final expected allowlist is empty for
`structuredContent.success === false` failure returns.

- [ ] **Step 3: 写 HTTP Job 终态失败测试**

Extend API route tests with three executions:

1. Invalid params -> `failed`, error `VALIDATION`.
2. Missing page -> `failed`, error `PAGE_REQUIRED`.
3. Handler throws unknown error -> `failed`, error `RUNTIME`.

Assert no failure is passed to `JobStore.complete`. Verify `retryable`, `recovery`,
and `details` survive `runJob -> JobStore -> WorkerHttpClient.getJob`.

- [ ] **Step 4: 确认测试失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/tool-failure-contract.test.js build/tests/unit/web/JobStore.test.js build/tests/unit/web/routes/apiV1.test.js
npm --prefix browsercli test
```

- [ ] **Step 5: 迁移基础和页面交互领域**

Convert runtime failures to `throw createToolError(...)` in these domains first:

- navigation, frames, page, input, dom, dialog, screenshot, stealth, extensions;
- collector and script;
- debugger and hook.

Use canonical codes from Tasks 1 and 3. Remove redundant catches that only convert
an exception to failure content; retain cleanup `finally` blocks and catches that
add materially useful context before rethrowing.

Run the affected unit tests after each domain, then remove those paths from the
temporary allowlist.

- [ ] **Step 6: 迁移网络、Wasm、工作流和分析领域**

Continue with network/WebSocket, sourcemap, Wasm, rebuild, performance, workflow,
anti-debug, JSVMP, analyzer, and crypto. Native binary absence must throw
`NATIVE_TOOL_MISSING`; an empty capture result remains success when the operation
itself completed.

- [ ] **Step 7: 收敛 JobStore 和 CLI 错误传输**

Update `JobStore` error shape and `apiV1.runJob` so rejected `ToolError` fields are
preserved. `complete` accepts only successful results. Update `WorkerHttpClient.invoke`
to throw an error object or formatted `Error` that includes code and recovery command;
do not collapse it to an opaque HTTP string.

- [ ] **Step 8: 验证 Task 6**

Run:

```bash
npm run build
node --require ./build/tests/setup.js --test build/tests/unit/tools/tool-failure-contract.test.js build/tests/unit/web/JobStore.test.js build/tests/unit/web/routes/apiV1.test.js build/tests/unit/worker/ToolResponseProcessor.test.js
npm --prefix browsercli test
```

Expected: the prohibited failure-response allowlist is empty and all failures produce terminal Job `failed`.

---

### Task 7: 对齐 CLI、Skill 文档和 Schema 校验器

**Files:**

- Modify: `scripts/verify-skills-schema.ts`
- Modify: `skills/**/*.md` only where verifier reports drift
- Modify: `C:\Users\Administrator\.claude\skills\browsercli\SKILL.md` only if user explicitly authorizes editing the external installed skill
- Test: `tests/unit/scripts/verify-skills-schema.test.ts`
- Test: `browsercli/tests/unit/help.test.ts`

**Interfaces:**

- Consumes: built `GENERATED_TOOL_REGISTRY`, ToolDefinition Schema, Task 4 strict keys.
- Produces: non-zero verifier exit on unknown tools, bad keys, missing required args, invalid enum literals, or invalid complex JSON.

- [ ] **Step 1: 提取纯函数并写 verifier 失败测试**

Refactor the script so parsing/validation functions are exported and `main()` only
runs when invoked as the entry point. Add fixture markdown strings covering:

- unknown tool;
- unknown parameter;
- a full command missing a required parameter;
- invalid enum literal;
- malformed JSON array/object;
- global control flags (`--data`, `--file`, `--stdin`, `--session`) that remain valid.

Assert each result includes file, line, tool and actionable mismatch text.

- [ ] **Step 2: 确认当前 verifier 不满足契约**

Run:

```bash
npm run build
npm run verify-skills
```

Expected before implementation: unknown tools may be skipped, normalized keys may
hide drift, and the process may exit 0 despite mismatches.

- [ ] **Step 3: 严格验证工具和参数**

Change `loadToolDefinitions` to retain canonical key, required/default, enum and
type metadata. Do not add normalized argument keys to the allowed set. Unknown
tools are errors. At the end set `process.exitCode = 1` when any error exists.

Treat bracketed synopsis examples (`[--arg <value>]`) as documentation signatures:
validate names and types but do not require every required arg. Treat executable
examples without brackets as full examples and require all no-default mandatory args.

- [ ] **Step 4: 修复仓库内 Skill 示例**

Run the verifier, edit only reported `skills/**/*.md` calls, rerun until zero
mismatches. Because the slash command also references an installed external Skill,
report any external mismatch separately unless explicit permission exists to edit
outside the repository.

- [ ] **Step 5: 验证 Task 7**

Run:

```bash
npm run build
npm run verify-skills
node --require ./build/tests/setup.js --test build/tests/unit/scripts/verify-skills-schema.test.js
npm --prefix browsercli test
```

Expected: all commands exit 0 and no normalized/alias argument is accepted.

---

### Task 8: 建立全工具契约、分类集成和高风险浏览器验证

**Files:**

- Create: `tests/unit/tools/all-tools-contract.test.ts`
- Create: `tests/integration/tool-categories.integration.test.ts`
- Create: `tests/integration/browsercli-reliability.integration.test.ts`
- Create: `tests/fixtures/browsercli-reliability/index.html`
- Create: `tests/fixtures/browsercli-reliability/app.js`
- Create: `tests/fixtures/browsercli-reliability/echo-server.mjs`
- Create: `tests/fixtures/browsercli-reliability/add.wasm`
- Modify: `package.json`
- Modify: manifests under `src/tools/*/manifest.ts` until requirement coverage is complete

**Interfaces:**

- Consumes: Tasks 1-7.
- Produces: three CI gates and complete runtime-requirement coverage for every registered tool.

- [ ] **Step 1: 写 Layer 1 全工具契约测试**

The test must obtain the exact full-profile set from `ToolRegistry` and assert for
every entry:

1. module and named handler load;
2. handler is a `ToolDefinition`;
3. unique tool name;
4. Schema introspection equals `ToolMeta.argSpecs`;
5. requirements survive Registry -> ToolMeta serialization;
6. each declared requirement is supported by `ToolPrerequisiteChecker`;
7. tools whose handler accesses page/frame/debugger are explicitly annotated;
8. no registered tool is omitted from the test loop.

Do not assert a hard-coded count such as 146. Assert equality between discovered,
loaded and checked sets so future additions are automatically included.

- [ ] **Step 2: 用契约测试补齐所有 manifest requirements**

Run the Layer 1 test and update each domain manifest according to actual handler
dependencies. Do not infer `requiresPage` merely from domain name; list/read the
handler. Mark recovery only for tools that diagnose or restore state.

- [ ] **Step 3: 创建确定性本地 fixture**

The fixture must provide:

- inline and external scripts with a named function and SourceMap;
- DOM button/input/form and iframe;
- fetch/XHR endpoint and WebSocket echo endpoint;
- local/session storage values;
- a minimal exported `add(i32, i32)` Wasm module;
- a controlled function where a breakpoint exposes a local variable.

The server binds loopback on an ephemeral port and closes all sockets in test teardown.

- [ ] **Step 4: 写 Layer 2 分类集成测试**

Create one subtest per category group, generated from Registry domains, with explicit
fixtures for page/frame, scripts/SourceMap, Hook/Debugger, DOM/input, network/WebSocket,
Wasm, rebuild/session, and AI fallback. Assert every domain is either covered by a
subtest or intentionally marked offline-only with a reason in the test source.

- [ ] **Step 5: 写 Layer 3 高风险真实浏览器流程**

In `browsercli-reliability.integration.test.ts`:

1. connect to or launch the test browser using existing integration harness patterns;
2. open the local fixture;
3. pause on the controlled function;
4. call a running-state tool and assert `DEBUGGER_PAUSED` under 250ms;
5. call `evaluate_on_callframe` and assert the local value;
6. call `resume`, then verify a normal DOM query succeeds;
7. install a Hook and assert a captured record;
8. assert HTTP request, initiator and WebSocket message capture;
9. collect/dump/inspect the minimal Wasm module;
10. save, mutate and restore storage state;
11. close fixture server and any pages created by the test.

The test must skip with a clear reason only when the repository's existing browser
integration prerequisites are unavailable; contract and category layers never skip.

- [ ] **Step 6: 增加精确测试脚本**

Add scripts without changing existing meanings:

```json
{
  "test:contracts": "npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/all-tools-contract.test.js build/tests/unit/tools/tool-failure-contract.test.js",
  "test:reliability:integration": "npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/integration/tool-categories.integration.test.js build/tests/integration/browsercli-reliability.integration.test.js"
}
```

- [ ] **Step 7: 运行由窄到宽的最终验证**

Run in this order after the final code change:

```bash
npm run test:contracts
npm run test:reliability:integration
npm --prefix browsercli test
npm run typecheck
npm run test:unit
npm run verify-skills
npm run check-format
```

If a command fails for a pre-existing unrelated reason, capture the exact test and
error, prove it is outside the final diff, and continue only with checks that remain
meaningful. Do not report completion while any changed-path test fails.

- [ ] **Step 8: 最终 diff 闭环**

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff -- docs/superpowers/specs/2026-08-19-browsercli-tool-reliability-contract-design.md docs/superpowers/plans/2026-08-19-browsercli-tool-reliability-contract.md src browsercli tests scripts package.json
```

Confirm every changed line traces to the spec and that no generated `build/`, real
artifacts, cookies, credentials, or temporary browser profiles are included.

## Completion Checklist

- [ ] Every registered full-profile tool is covered by the offline contract loop.
- [ ] Debugger paused guards fail before handler dispatch and under 250ms.
- [ ] No guard enables a CDP domain or automatically resumes execution.
- [ ] Parameter aliases are rejected by Worker and not rewritten by CLI.
- [ ] AI-unconfigured analyzer calls return local results within 2 seconds with explicit metadata.
- [ ] No runtime failure result is stored as Job `done`.
- [ ] Skill/document examples pass strict Schema verification.
- [ ] Category integration and high-risk local-browser flow pass.
- [ ] `typecheck`, `test:unit`, `verify-skills`, and `check-format` have fresh final-diff evidence.
