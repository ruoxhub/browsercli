# Bounded Reverse Agent Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a callable `start_reverse_task -> run_reverse_agent -> manage_reverse_task` vertical slice that can execute the repository's existing reverse-task plan to a bounded, explainable stop and persist enough evidence to resume safely.

**Architecture:** Keep `ReverseTaskOrchestrator` as the deterministic planner and deepen `ExecutionAdapters` into the single action-controller seam shared by one-shot orchestration and the new bounded runner. The runner adds Browser Use-inspired history, stall detection, explicit stop reasons, and bounded rounds; it does not introduce Browser Use, a second LLM planner, semantic DOM extraction, or multi-action batching. Existing code under `open-source/JSReverser-MCP/` is the behavior oracle, but its monolithic `agent-runner.ts` must be adapted to the current manifest layout, `getRuntime()`, and `structuredContent` response contract.

**Tech Stack:** TypeScript ESM, `node:test`, Zod, existing MCP `defineTool`, `ToolResponseAccumulator`, SWC, existing reverse-task artifact store.

## Shortest Execution Path

1. Tasks 1-3: establish typed failures and make `locate -> search -> extract` executable.
2. Task 4: generate pure-draft and portable artifacts through reusable modules.
3. Task 5: close planner/adapter parity so orchestration has no advertised-but-unimplemented step.
4. Tasks 6-7: add the plan-before-execute runner and expose the four workflow tools.
5. Tasks 8-9: lock the response schema, document limits, and run the final-diff verification loop.

The first usable milestone is the end of Task 7. Tasks 8-9 are required before reporting the feature complete.

**Evidence / behavior oracle:**

- `open-source/JSReverser-MCP/src/tools/agent-runner.ts:116` — legacy leaf-step execution.
- `open-source/JSReverser-MCP/src/tools/agent-runner.ts:305` — step fingerprinting.
- `open-source/JSReverser-MCP/src/tools/agent-runner.ts:366` — pure-draft materialization.
- `open-source/JSReverser-MCP/src/tools/agent-runner.ts:631` — stop rules.
- `open-source/JSReverser-MCP/src/tools/agent-runner.ts:655` — public `run_reverse_agent` contract.
- `open-source/JSReverser-MCP/src/tools/analyzer.ts:1109` and `:1856` — signature candidate scoring and tool contract.
- `open-source/JSReverser-MCP/src/tools/debugger.ts:525` — function-tree wrapper and persistence.
- `open-source/JSReverser-MCP/src/tools/rebuild.ts:581` and `:665` — portable bundle generation.
- `open-source/JSReverser-MCP/tests/unit/tools/reverse-task-tools.test.ts:850` onward — signature-only, pure-draft, and port-ready acceptance behavior.

## Global Constraints

- Do not change `defineTool`, `Runtime`, or `getRuntime` signatures; they are high-fan-in stable interfaces.
- Do not add a dependency. Reuse `ToolResponseAccumulator`, `ReverseTaskExecutor`, checkpoints, response builders, and the manifest generator.
- Do not call tool handlers through the external MCP/HTTP pipeline. In-process adapters may invoke the existing handler function with `ToolResponseAccumulator`, then must validate `structuredContent.success` before using `data`.
- Add debugger capability lazily. `search_in_sources` and `extract_function_tree` may request a debugger only when their step executes; never eager-enable CDP during startup.
- Preserve the anti-detection boundary: no new browser launch flags, no implicit JS stealth injection, and no viewport changes.
- Treat task artifacts as task-local evidence. Do not copy real cookies, storage, request bodies, target hosts, or generated `artifacts/tasks/*` content into tracked fixtures.
- Register tools through domain manifests and regenerate `src/tools/generated-tools-index.ts` with `npm run build:index`; never hand-edit the generated file.
- All new tool responses use `response.setStructuredContent(...)`. Fenced JSON is legacy input compatibility only, not the new output contract.
- Keep the initial runner intentionally bounded: one planned batch per round, sequential steps, `maxRounds <= 20`, no parallel action batch, no semantic DOM/action model, and no second autonomous planner.
- A retryable failed step stops with `checkpoint_required`; a non-retryable failure stops with `blocked`. The runner never retries indefinitely inside one call.
- Preserve unrelated dirty-worktree changes. Stage only files listed by the current task when following the optional commit steps.

---

## Target Module Shape

| Action    | File                                                   | Responsibility                                                                    |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Create    | `src/tools/analyzer/locateSignatureFunction.ts`        | Rank likely signing functions and optionally persist `signature-locate.json`.     |
| Modify    | `src/tools/analyzer/index.ts`                          | Export the locator tool.                                                          |
| Modify    | `src/tools/analyzer/manifest.ts`                       | Register `locate_signature_function` in the workflow profile.                     |
| Modify    | `src/modules/debugger/DebuggerManager.ts`              | Add the missing delegate to `ScriptManager.extractFunctionTree`.                  |
| Modify    | `src/tools/debugger/index.ts`                          | Add single-match task persistence to `search_in_sources`.                         |
| Create    | `src/tools/debugger/extractFunctionTree.ts`            | Public `extract_function_tree` tool plus task-artifact persistence.               |
| Modify    | `src/tools/debugger/manifest.ts`                       | Register `extract_function_tree`.                                                 |
| Create    | `src/reverse/PureExtractionDraft.ts`                   | Materialize pure-draft fixtures, implementation skeleton, and self-check.         |
| Create    | `src/reverse/PortableBundle.ts`                        | Build and verify `run/portable.js` / `env/replay.js` from existing artifacts.     |
| Create    | `src/tools/rebuild/portable.ts`                        | Thin MCP wrapper over `PortableBundle`.                                           |
| Modify    | `src/tools/rebuild/manifest.ts`                        | Register `export_portable_bundle`.                                                |
| Create    | `src/reverse/ReverseTaskExecutionError.ts`             | Typed failure metadata shared by adapters and executor.                           |
| Modify    | `src/reverse/ExecutionAdapters.ts`                     | Become the complete controller registry for every step the orchestrator can plan. |
| Modify    | `src/reverse/ReverseTaskExecutor.ts`                   | Propagate lazy debugger runtime and consume typed failures.                       |
| Modify    | `src/reverse/ReverseTaskOrchestrator.ts`               | Pass execution runtime through without changing existing callers.                 |
| Modify    | `src/reverse/ReverseAgentRunner.ts`                    | Implement the bounded loop and stop-state machine.                                |
| Create    | `src/tools/reverse/start.ts`                           | Public task initialization tool.                                                  |
| Create    | `src/tools/reverse/manage.ts`                          | Public unified task-management facade.                                            |
| Create    | `src/tools/reverse/orchestrate.ts`                     | Public single-round plan/execute facade.                                          |
| Create    | `src/tools/reverse/runAgent.ts`                        | Public bounded-agent facade and response shaping.                                 |
| Create    | `src/tools/reverse/manifest.ts`                        | Workflow-profile registration for the four reverse tools.                         |
| Generated | `src/tools/generated-tools-index.ts`                   | Generated registry entries for new/changed manifests.                             |
| Create    | `tests/unit/reverse/ReverseTaskExecutionError.test.ts` | Typed failure classification contract.                                            |
| Create    | `tests/unit/reverse/ExecutionAdapters.test.ts`         | Planner/action-registry coverage contract.                                        |
| Create    | `tests/unit/reverse/ReverseAgentRunner.test.ts`        | Pure stop-state-machine tests.                                                    |
| Create    | `tests/unit/tools/reverse-analysis-tools.test.ts`      | Locator/search/extract persistence tests.                                         |
| Create    | `tests/unit/tools/rebuild/portable.test.ts`            | Portable generation and verification tests.                                       |
| Create    | `tests/unit/tools/reverse-agent-tools.test.ts`         | End-to-end public tool flows.                                                     |
| Create    | `tests/unit/tools/reverse/manifest.test.ts`            | Workflow-profile tool registration contract.                                      |
| Modify    | `docs/reference/reverse-agent-response.schema.json`    | Describe the concrete `run` and generated-artifact fields.                        |
| Modify    | `docs/guides/reverse-task-orchestration.md`            | Document bounded-agent usage and limitations.                                     |

## State Machine and Invariants

```text
plan current task state
  -> fingerprint primary step
  -> duplicate fingerprint? --------------------------> stalled
  -> execute suggested steps through ExecutionAdapters
       -> retryable failure --------------------------> checkpoint_required
       -> non-retryable failure ----------------------> blocked
  -> read post-execution state
       -> status=pass --------------------------------> task_passed
       -> signature-only + function-slice.json -------> analysis_completed
       -> understand_code + pure-extraction.json -----> pure_extraction_ready
  -> next round
       -> round budget exhausted ---------------------> max_rounds
```

Required invariants:

1. Every tool emitted by `buildPrimaryStep` / `buildStrategyPrimaryStep` has exactly one registered execution adapter.
2. Every stop path calls `markReverseAgentStop` exactly once.
3. `roundsExecuted === rounds.length`.
4. A round result is appended for success, failure, and stall paths.
5. A failed orchestration checkpoint is preserved; the runner does not overwrite it with a success checkpoint.
6. `signature-only` never generates pure-extraction drafts.
7. `autoExportPortable` is honored only for `goalMode='port-ready'` after `pure_extraction_ready`.
8. Compact mode may remove verbose details, but never removes `schemaVersion`, `outcome`, `continuation`, `run.stopReason`, or `generatedArtifacts`.

---

### Task 1: Add typed execution failures

**Files:**

- Create: `src/reverse/ReverseTaskExecutionError.ts`
- Modify: `src/reverse/ReverseTaskExecutor.ts`
- Create: `tests/unit/reverse/ReverseTaskExecutionError.test.ts`

- [ ] **Step 1: Write the failing classification test**

```typescript
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  classifyReverseTaskFailure,
  ReverseTaskExecutionError,
} from '../../../src/reverse/ReverseTaskExecutionError.js';

describe('classifyReverseTaskFailure', () => {
  it('preserves typed adapter metadata', () => {
    const result = classifyReverseTaskFailure(
      new ReverseTaskExecutionError(
        'debugger context unavailable',
        'external_error',
        true,
      ),
    );
    assert.deepStrictEqual(result, {
      failureType: 'external_error',
      retryable: true,
    });
  });

  it('keeps the existing message fallback for untyped errors', () => {
    assert.deepStrictEqual(
      classifyReverseTaskFailure(new Error('window is not defined')),
      {failureType: 'env_error', retryable: true},
    );
    assert.deepStrictEqual(
      classifyReverseTaskFailure(new Error('taskId is required')),
      {failureType: 'validation_error', retryable: false},
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/reverse/ReverseTaskExecutionError.test.js
```

Expected: compilation fails because `ReverseTaskExecutionError.ts` does not exist.

- [ ] **Step 3: Implement the typed error as the single classification module**

```typescript
import type {ReverseTaskFailureType} from './ReverseTaskCheckpoint.js';

export class ReverseTaskExecutionError extends Error {
  constructor(
    message: string,
    readonly failureType: ReverseTaskFailureType,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ReverseTaskExecutionError';
  }
}

export function classifyReverseTaskFailure(error: unknown): {
  failureType: ReverseTaskFailureType;
  retryable: boolean;
} {
  if (error instanceof ReverseTaskExecutionError) {
    return {failureType: error.failureType, retryable: error.retryable};
  }

  const normalized = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  if (
    normalized.includes('timed out') ||
    normalized.includes('fetch failed') ||
    normalized.includes('browser failed')
  ) {
    return {failureType: 'external_error', retryable: true};
  }
  if (normalized.includes('not implemented')) {
    return {failureType: 'tool_error', retryable: true};
  }
  if (normalized.includes('invalid') || normalized.includes('required')) {
    return {failureType: 'validation_error', retryable: false};
  }
  if (
    normalized.includes('window is not defined') ||
    normalized.includes('localstorage is not defined') ||
    normalized.includes('subtle')
  ) {
    return {failureType: 'env_error', retryable: true};
  }
  return {failureType: 'unknown', retryable: false};
}
```

Delete the duplicate private `classifyFailure` from `ReverseTaskExecutor.ts` and call `classifyReverseTaskFailure(error)` directly so typed metadata is not lost by converting to a string first. When writing task state after failure, use `status:'partial'` for retryable failures and `status:'blocked'` for non-retryable failures; the checkpoint itself remains `failed` in both cases. This keeps `checkpoint_required` resumable instead of contradicting it with a terminal task status.

- [ ] **Step 4: Run the focused test**

Expected: 2 tests pass.

- [ ] **Step 5: Optional checkpoint commit**

```bash
git add src/reverse/ReverseTaskExecutionError.ts src/reverse/ReverseTaskExecutor.ts tests/unit/reverse/ReverseTaskExecutionError.test.ts
git commit -m "refactor(reverse): type execution failure metadata"
```

---

### Task 2: Port signature location as a focused analyzer tool

**Files:**

- Create: `src/tools/analyzer/locateSignatureFunction.ts`
- Modify: `src/tools/analyzer/index.ts`
- Modify: `src/tools/analyzer/manifest.ts`
- Create: `tests/unit/tools/reverse-analysis-tools.test.ts`

- [ ] **Step 1: Add a failing ranking-and-persistence test**

Use a temporary `ReverseTaskStore` and stub only `runtime.collector.collect` plus `runtime.collector.getTopPriorityFiles`. Feed these two functions:

```javascript
function renderCard(value) {
  return String(value);
}
function genH5st(appid, body, functionId) {
  const timestamp = Date.now();
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
}
```

Call `locateSignatureFunction.handler` with `targetParam: 'h5st'`, related parameters, and persistence metadata. Assert:

```typescript
assert.equal(payload.success, true);
assert.equal(payload.data.candidates[0].functionName, 'genH5st');
assert.equal(payload.data.persisted, true);
assert.equal(
  (
    await store.readSnapshot<Record<string, unknown>>(
      taskId,
      'signature-locate.json',
    )
  )?.targetParam,
  'h5st',
);
assert.equal(
  (
    (
      await store.readSnapshot<Record<string, unknown>>(
        taskId,
        'target-context.json',
      )
    )?.locatedSignature as {functionName?: string}
  ).functionName,
  'genH5st',
);
```

- [ ] **Step 2: Run the focused test and confirm the missing export failure**

Run the same build command as Task 1, then:

```bash
node --require ./build/tests/setup.js --test build/tests/unit/tools/reverse-analysis-tools.test.js
```

Expected: the locator module/export is missing.

- [ ] **Step 3: Adapt the proven locator, not the monolithic analyzer file**

Move only the following behavior from the behavior oracle into the new file:

- `SignatureFunctionCandidate`.
- `collectFunctionCandidatesFromCode` scoring.
- collection normalization and top-priority fallback.
- `locate_signature_function` Zod schema and persistence of `target-context.json`, `signature-locate.json`, and one runtime-evidence record.

Use the current imports:

```typescript
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
```

Return the current response envelope:

```typescript
response.setStructuredContent({
  success: true,
  message:
    candidates.length > 0
      ? `定位到 ${candidates.length} 个签名函数候选`
      : '未定位到签名函数候选',
  tooltype: 'locate_signature_function',
  data: result,
});
```

On errors, return `success:false` with an empty, schema-stable `data` object. Do not append fenced JSON.

- [ ] **Step 4: Export and register the tool**

Add this manifest entry:

```typescript
{
  modulePath: './analyzer/locateSignatureFunction.js',
  handlerName: 'locateSignatureFunction',
},
```

- [ ] **Step 5: Run the focused test**

Expected: the candidate ranking and both persisted snapshots pass.

- [ ] **Step 6: Optional checkpoint commit**

```bash
git add src/tools/analyzer/locateSignatureFunction.ts src/tools/analyzer/index.ts src/tools/analyzer/manifest.ts tests/unit/tools/reverse-analysis-tools.test.ts
git commit -m "feat(analyzer): add signature function locator"
```

---

### Task 3: Complete the source-search-to-function-slice chain

**Files:**

- Modify: `src/modules/debugger/DebuggerManager.ts`
- Modify: `src/tools/debugger/index.ts`
- Create: `src/tools/debugger/extractFunctionTree.ts`
- Modify: `src/tools/debugger/manifest.ts`
- Modify: `tests/unit/tools/reverse-analysis-tools.test.ts`

- [ ] **Step 1: Add failing tests for the two persisted transitions**

Add two cases:

1. `search_in_sources` with exactly one displayed match and `persistResult:true` writes `target-context.json.locatedSource`.
2. `extract_function_tree` writes `function-slice.json` and updates `target-context.json.functionSlice`.

The first assertion must verify the one-match guard: two underlying matches must not persist an arbitrary source, even when `maxResults:1` displays only one. The second uses a fake debugger runtime whose `extractFunctionTree` returns:

```typescript
{
  mainFunction: 'genH5st',
  code: 'function genH5st(input) { return hash(input); }',
  functions: [
    {
      name: 'genH5st',
      code: 'function genH5st(input) { return hash(input); }',
      dependencies: ['hash'],
      startLine: 1,
      endLine: 1,
      size: 49,
    },
  ],
  callGraph: {genH5st: ['hash']},
  totalSize: 49,
  extractedCount: 1,
}
```

- [ ] **Step 2: Run the focused tests and confirm the missing behavior**

Expected: search does not persist and `extract_function_tree` is not registered.

- [ ] **Step 3: Add only the missing DebuggerManager delegate**

```typescript
async extractFunctionTree(
  scriptId: string,
  functionName: string,
  options: {
    maxDepth?: number;
    maxSize?: number;
    includeComments?: boolean;
  } = {},
) {
  return this.scriptManager.extractFunctionTree(
    scriptId,
    functionName,
    options,
  );
}
```

Do not alter debugger activation. The wrapper obtains it through `getDebuggerFromContext` only when called.

- [ ] **Step 4: Extend `search_in_sources` with optional task persistence**

Add optional `taskId`, `taskSlug`, `targetUrl`, `goal`, and `persistResult` fields to its schema. After `safeMatches` is finalized, persist only when all task metadata is present, `totalMatches === 1`, and `safeMatches.length === 1`. The `totalMatches` guard prevents `maxResults:1` or size truncation from turning an ambiguous search into a false unique match. Write the same `locatedSource` fields as the behavior oracle and append a `source-locate` runtime-evidence row.

Keep the normal search result envelope unchanged. Add `persisted: boolean` under `data` so the adapter can verify the state transition.

- [ ] **Step 5: Implement `extract_function_tree` as a thin tool wrapper**

Its schema is the legacy schema without `pageIdx`; use the current lazy `DebuggerRuntime` path. On success:

```typescript
response.setStructuredContent({
  success: true,
  message: `已提取 ${result.extractedCount} 个函数`,
  tooltype: 'extract_function_tree',
  data: {...result, persisted},
});
```

When persistence is requested, copy the exact artifact writes from `open-source/JSReverser-MCP/src/tools/debugger.ts:651-700`, adapted from `getJSHookRuntime()` to `getRuntime()`.

- [ ] **Step 6: Register the tool and rerun the focused tests**

Add:

```typescript
{
  modulePath: './debugger/extractFunctionTree.js',
  handlerName: 'extractFunctionTree',
},
```

Expected: search ambiguity is safe, a unique source becomes extractable, and the slice is persisted.

- [ ] **Step 7: Optional checkpoint commit**

```bash
git add src/modules/debugger/DebuggerManager.ts src/tools/debugger/index.ts src/tools/debugger/extractFunctionTree.ts src/tools/debugger/manifest.ts tests/unit/tools/reverse-analysis-tools.test.ts
git commit -m "feat(debugger): persist source location and function slices"
```

---

### Task 4: Materialize pure drafts and portable delivery through deep modules

**Files:**

- Create: `src/reverse/PureExtractionDraft.ts`
- Create: `src/reverse/PortableBundle.ts`
- Create: `src/tools/rebuild/portable.ts`
- Modify: `src/tools/rebuild/manifest.ts`
- Create: `tests/unit/reverse/PureExtractionDraft.test.ts`
- Create: `tests/unit/tools/rebuild/portable.test.ts`

- [ ] **Step 1: Write failing pure-draft tests**

Given task snapshots for a function slice, understanding result, deobfuscation result, target context, and one runtime-evidence body sample, call:

```typescript
await materializePureExtractionDrafts(store, taskId, 'pure-draft');
```

Assert these exact files exist:

```typescript
['run/fixtures.json', 'run/pure-main.js', 'run/pure-selftest.test.mjs'];
```

Assert `fixtures.json` contains `goalMode`, `mainFunction`, one sample, and `derivedFrom`; assert the generated self-test imports `./pure-main.js` and fails only if the draft result is not an object. Add a separate `port-ready` case asserting the explicit `signature-result-v1` output contract and input/output adapter boundary.

- [ ] **Step 2: Implement the store-driven draft materializer**

Adapt `materializePureExtractionDrafts` from `agent-runner.ts:366-629`, but change its signature to avoid the global runtime:

```typescript
export type ReverseAgentGoalMode =
  | 'signature-only'
  | 'pure-draft'
  | 'port-ready';

export async function materializePureExtractionDrafts(
  store: ReverseTaskStore,
  taskId: string,
  goalMode: Exclude<ReverseAgentGoalMode, 'signature-only'>,
): Promise<string[]>;
```

Return the three relative paths after successful writes. Normalize current structured tool snapshots before reading results: `snapshot.result.data ?? snapshot.result`, because the current analyzer/deobfuscator handlers return `{success,message,tooltype,data}`.

- [ ] **Step 3: Write failing portable-bundle tests**

Cover both modes:

- pure inputs produce `run/portable.js` containing exports and pass verification;
- rebuild inputs produce `env/replay.js` containing `CAPTURE` and pass verification;
- missing source artifacts produce no output for that mode rather than an empty file.

- [ ] **Step 4: Implement `PortableBundle` as the one reusable API**

Use this public contract:

```typescript
export interface PortableBundleResult {
  taskId: string;
  taskDir: string;
  artifactMode: 'portable' | 'rebuild' | 'pure';
  generatedFiles: string[];
  compactDelivery: boolean;
  verification: {
    checked: true;
    ok: boolean;
    verifiedFiles: string[];
    errors: string[];
  };
}

export async function exportPortableArtifacts(
  store: ReverseTaskStore,
  taskId: string,
  options?: {
    artifactMode?: 'portable' | 'rebuild' | 'pure';
    includePurePortable?: boolean;
    includeRebuildPortable?: boolean;
  },
): Promise<PortableBundleResult>;
```

Adapt generation, verification, state update, timeline, and runtime-evidence persistence from `open-source/JSReverser-MCP/src/tools/rebuild.ts:12-139` and `:581-749`. The MCP tool in `src/tools/rebuild/portable.ts` must only validate input, call this function, and set a structured response.

- [ ] **Step 5: Register and run focused tests**

Add to the rebuild manifest:

```typescript
{
  modulePath: './rebuild/portable.js',
  handlerName: 'exportPortableBundle',
},
```

Expected: draft and portable test files all pass.

- [ ] **Step 6: Optional checkpoint commit**

```bash
git add src/reverse/PureExtractionDraft.ts src/reverse/PortableBundle.ts src/tools/rebuild/portable.ts src/tools/rebuild/manifest.ts tests/unit/reverse/PureExtractionDraft.test.ts tests/unit/tools/rebuild/portable.test.ts
git commit -m "feat(reverse): materialize pure and portable artifacts"
```

---

### Task 5: Make `ExecutionAdapters` the complete action-controller seam

**Files:**

- Modify: `src/reverse/ExecutionAdapters.ts`
- Modify: `src/reverse/ReverseTaskExecutor.ts`
- Modify: `src/reverse/ReverseTaskOrchestrator.ts`
- Create: `tests/unit/reverse/ExecutionAdapters.test.ts`

- [ ] **Step 1: Write the failing planner/adapter parity test**

Expose a read-only predicate:

```typescript
export function supportsAutomaticStep(tool: string): boolean;
```

The test must assert all possible primary tools are covered:

```typescript
const plannedTools = [
  'manage_reverse_task',
  'locate_signature_function',
  'search_in_sources',
  'extract_function_tree',
  'understand_code',
  'export_rebuild_bundle',
  'diff_env_requirements',
  'export_portable_bundle',
];

assert.deepStrictEqual(
  plannedTools.filter(tool => !supportsAutomaticStep(tool)),
  [],
);
```

This is the regression guard that prevents a planner from advertising an unexecutable step again.

- [ ] **Step 2: Run the test and confirm the five missing analysis adapters**

Expected: locator, source search, function extraction, understanding, and portable export are unsupported.

- [ ] **Step 3: Replace the incomplete response shim with the existing accumulator**

Use `ToolResponseAccumulator` and a private extractor that supports the current envelope:

```typescript
function readStructuredToolData(
  response: ToolResponseAccumulator,
): Record<string, unknown> {
  const content = response.toJSON().structuredContent;
  if (!content || typeof content !== 'object') {
    throw new ReverseTaskExecutionError(
      'tool returned no structured content',
      'tool_error',
      true,
    );
  }
  const envelope = content as Record<string, unknown>;
  if (envelope.success === false) {
    throw new ReverseTaskExecutionError(
      String(envelope.message ?? 'tool execution failed'),
      'tool_error',
      true,
    );
  }
  return envelope.data && typeof envelope.data === 'object'
    ? (envelope.data as Record<string, unknown>)
    : envelope;
}
```

Delete `makeToolResponse` and `extractToolJson`. Update the existing rebuild/diff adapters to read their current `structuredContent.data` instead of silently seeing an empty fenced-JSON payload.

- [ ] **Step 4: Add lazy debugger-runtime plumbing as optional fields**

Use the already narrow `DebuggerRuntime` interface from `src/tools/debugger/runtime-helpers.ts`:

```typescript
export interface ExecutionAdapterContext {
  store: ReverseTaskStore;
  taskId: string;
  currentStage: string;
  step: ReverseTaskExecutableStep;
  override?: ReverseTaskExecutionOverride;
  debuggerRuntime?: DebuggerRuntime;
  goalMode?: ReverseAgentGoalMode;
}
```

Add `debuggerRuntime?: DebuggerRuntime` and `goalMode?: ReverseAgentGoalMode` to executor and orchestrator options and pass them through unchanged. The understanding adapter uses `goalMode ?? 'pure-draft'` when writing `pure-extraction.json` and generating drafts. Existing callers remain source-compatible because both properties are optional; direct `orchestrate_reverse_task(execute=true)` therefore retains the pure-draft default.

When `execute:true`, also derive the orchestrator's returned `currentStage`, `status`, `nextStepHint`, and `currentSummary` from `postExecution.state` with the pre-execution values as fallback. The current implementation reads the post-execution snapshot but returns the stale pre-execution fields; fixing that shared function prevents both the public orchestration tool and the runner from reporting yesterday's state.

- [ ] **Step 5: Register the analysis-chain adapters**

Implement these exact state transitions:

| Tool                        | Action                                                                                                                                               | Required durable result                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `locate_signature_function` | Invoke locator with task metadata and `persistResult:true`.                                                                                          | `signature-locate.json`, `target-context.locatedSignature`.                                                                                   |
| `search_in_sources`         | Require lazy debugger runtime, invoke with task metadata and `persistResult:true`.                                                                   | A single match writes `target-context.locatedSource`; zero/many matches leave it unset and cause the next repeated plan to stop as `stalled`. |
| `extract_function_tree`     | Require lazy debugger runtime and persist result.                                                                                                    | `function-slice.json`, `target-context.functionSlice`.                                                                                        |
| `understand_code`           | Invoke current understand + deobfuscate handlers, validate both envelopes, write both snapshots and `pure-extraction.json`, then materialize drafts. | Stage becomes `PureExtraction`, status `partial`, next hint `manage_reverse_task:summarize`.                                                  |
| `export_portable_bundle`    | Call `exportPortableArtifacts` directly.                                                                                                             | At least one generated file or a typed non-retryable validation failure.                                                                      |

When no debugger runtime is supplied, throw:

```typescript
new ReverseTaskExecutionError(
  'debugger runtime unavailable for browser-backed reverse step',
  'external_error',
  true,
);
```

Do not duplicate the old runner's `executeRoundStep`; delete nothing outside the existing adapter seam.

- [ ] **Step 6: Add focused adapter behavior tests**

In addition to parity, assert:

- missing debugger runtime is `external_error` and retryable;
- a `success:false` tool envelope is `tool_error` and retryable;
- a retryable executor failure leaves task state `partial`, while a non-retryable failure leaves it `blocked`;
- an `understand_code` success produces the pure-draft artifacts and `nextStage:'PureExtraction'`;
- existing `export_rebuild_bundle` reads the structured `data.files` count correctly.
- `orchestrateReverseTask(..., {execute:true})` returns the post-execution stage/status fields.

- [ ] **Step 7: Run reverse executor/orchestrator regression tests**

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/reverse/ExecutionAdapters.test.js
```

Expected: all pass; the same test file covers registry parity, typed executor failure/checkpoint propagation, and adapter outputs, so no orchestrator-planned tool is missing an adapter.

- [ ] **Step 8: Optional checkpoint commit**

```bash
git add src/reverse/ExecutionAdapters.ts src/reverse/ReverseTaskExecutor.ts src/reverse/ReverseTaskOrchestrator.ts tests/unit/reverse/ExecutionAdapters.test.ts
git commit -m "feat(reverse): complete orchestration action adapters"
```

---

### Task 6: Implement the bounded runner state machine

**Files:**

- Modify: `src/reverse/ReverseAgentRunner.ts`
- Create: `tests/unit/reverse/ReverseAgentRunner.test.ts`

- [ ] **Step 1: Write failing stop-matrix tests with injected dependencies**

Add an optional dependency seam so these tests do not require a browser or global runtime:

```typescript
export interface ReverseAgentDependencies {
  orchestrate: typeof orchestrateReverseTask;
  executePlan: typeof executeReverseTaskPlan;
  getState: typeof getReverseTaskState;
  markStop: typeof markReverseAgentStop;
  artifactExists(
    store: ReverseTaskStore,
    taskId: string,
    relativePath: string,
  ): Promise<boolean>;
  exportPortable: typeof exportPortableArtifacts;
}
```

Cover this exact matrix:

| Condition                                                               | Expected stop reason    |
| ----------------------------------------------------------------------- | ----------------------- |
| post-state status is `pass`                                             | `task_passed`           |
| `signature-only` and `function-slice.json` exists                       | `analysis_completed`    |
| executed primary is `understand_code` and `pure-extraction.json` exists | `pure_extraction_ready` |
| failed step with `recovery.shouldResume=true`                           | `checkpoint_required`   |
| failed step with `recovery.shouldResume=false`                          | `blocked`               |
| the same primary-step fingerprint is planned twice                      | `stalled`               |
| no earlier stop at the round limit                                      | `max_rounds`            |

Each case also asserts one `markStop` call and `roundsExecuted === rounds.length`.

- [ ] **Step 2: Run the focused test and confirm `runReverseAgent` is missing**

- [ ] **Step 3: Add the input and result contracts**

```typescript
export interface RunReverseAgentInput {
  taskId: string;
  maxRounds?: number;
  strategy?:
    | 'observe-first'
    | 'rebuild-first'
    | 'env-fix'
    | 'artifact-sync'
    | 'evidence-only';
  goalMode?: ReverseAgentGoalMode;
  autoExportPortable?: boolean;
  includeSummary?: boolean;
}

export interface RunReverseAgentOptions {
  debuggerRuntime?: DebuggerRuntime;
}
```

Validate in the function as defense in depth: `maxRounds` defaults to 6 and must be an integer in `[1, 20]`, even though the MCP schema also validates it.

- Keep the existing `ReverseAgentRunResult.lastOrchestration` field and extend the result with `goalMode`, `maxRounds`, `generatedArtifacts`, `finalState`, and an optional `portableExport` diagnostic. `lastOrchestration.execution` is the result returned by `executePlan`; this lets the MCP facade build failure continuation without querying or re-running a step.

- [ ] **Step 4: Implement plan-before-execute ordering for every round**

First obtain a non-executing plan:

```typescript
const plan = await dependencies.orchestrate(store, input.taskId, {
  persistState: true,
  includeSummary: false,
  execute: false,
  outputMode: 'verbose',
  strategy: round === 1 ? input.strategy : undefined,
});
```

Use the primary-step fingerprint before executing a repeated plan. The fingerprint consists of `tool` plus `JSON.stringify(params ?? {})`; keep it private and deterministic by using the orchestrator's already-normalized parameter objects. On a duplicate, append a zero-completion round and stop without invoking the repeated step.

Only after the fingerprint is accepted, run the already-planned batch through the shared executor:

```typescript
const execution = await dependencies.executePlan(
  store,
  input.taskId,
  plan.orchestration.suggestedSteps,
  {
    currentStage: plan.currentStage,
    stopOnError: true,
    debuggerRuntime: options.debuggerRuntime,
    goalMode,
  },
);
const result = {...plan, execution};
```

This ordering is mandatory: `orchestrate(execute=true)` would execute a repeated step before the runner could classify it as stalled. The public one-round orchestration tool may still use `execute:true`; only the bounded loop needs the pre-execution guard.

After each executed round, read fresh state, append the round record, then apply the stop matrix in the order shown above. On `max_rounds`, mark the stop after the final post-state read.

- [ ] **Step 5: Handle optional portable export through the deep module**

Only when all conditions are true:

```typescript
input.autoExportPortable === true &&
  goalMode === 'port-ready' &&
  stopReason === 'pure_extraction_ready';
```

call `dependencies.exportPortable(store, taskId, {artifactMode:'pure'})`. Add its files to `generatedArtifacts`; if it throws, return the original successful analysis stop plus a `portableExport` failure diagnostic rather than erasing the completed analysis artifacts.

- [ ] **Step 6: Run the stop-matrix tests**

Expected: all seven stop reasons pass, stop logging is exactly-once, and no fake plan executes after stall detection.

- [ ] **Step 7: Optional checkpoint commit**

```bash
git add src/reverse/ReverseAgentRunner.ts tests/unit/reverse/ReverseAgentRunner.test.ts
git commit -m "feat(reverse): add bounded reverse agent runner"
```

---

### Task 7: Expose the public reverse-task tool surface

**Files:**

- Create: `src/tools/reverse/start.ts`
- Create: `src/tools/reverse/manage.ts`
- Create: `src/tools/reverse/orchestrate.ts`
- Create: `src/tools/reverse/runAgent.ts`
- Create: `src/tools/reverse/manifest.ts`
- Generated: `src/tools/generated-tools-index.ts`
- Create: `tests/unit/tools/reverse/manifest.test.ts`
- Create: `tests/unit/tools/reverse-agent-tools.test.ts`

- [ ] **Step 1: Write a failing manifest contract test**

```typescript
assert.equal(manifest.name, 'reverse');
assert.equal(manifest.profile, 'workflow');
assert.deepStrictEqual(
  manifest.tools.map(item => item.handlerName),
  [
    'startReverseTaskTool',
    'manageReverseTaskTool',
    'orchestrateReverseTaskTool',
    'runReverseAgentTool',
  ],
);
```

- [ ] **Step 2: Implement `start`, `manage`, and `orchestrate` as thin facades**

Adapt the schemas and action dispatch from:

- `open-source/JSReverser-MCP/src/tools/task.ts` (`start_reverse_task` only; do not add request-derived task creation in this slice).
- `open-source/JSReverser-MCP/src/tools/task-manager.ts`.
- `open-source/JSReverser-MCP/src/tools/orchestrator.ts`.

Required adaptations:

- import `getRuntime` from `../../runtime.js`;
- use current split reverse modules;
- call `response.setStructuredContent(...)` once;
- keep `withSchemaVersion`, compact payloads, diagnostics, and continuation builders;
- pass `debuggerRuntime: context` from the orchestrate tool only when `execute:true`;
- keep all current manage actions because their implementation already exists; do not introduce a second partial management API.

- [ ] **Step 3: Implement the `run_reverse_agent` MCP wrapper**

Keep the proven external schema:

```typescript
{
  taskId: zod.string().min(1),
  maxRounds: zod.number().int().positive().max(20).optional().default(6),
  strategy: zod.enum([
    'observe-first',
    'rebuild-first',
    'env-fix',
    'artifact-sync',
    'evidence-only',
  ]).optional(),
  goalMode: zod.enum([
    'signature-only',
    'pure-draft',
    'port-ready',
  ]).optional().default('pure-draft'),
  autoExportPortable: zod.boolean().optional().default(false),
  outputMode: zod.enum(['compact', 'verbose']).optional().default('verbose'),
  includeSummary: zod.boolean().optional().default(true),
}
```

Call the core runner, derive `agentGuidance` with the existing `buildRunReverseAgentHints`, and shape the response with `buildOrchestrationContinuation`, `compactAgentPayload`, and `withSchemaVersion`. Use `setStructuredContent(payload)`.

The output must retain:

```typescript
{
  taskId,
  run: {
    roundsExecuted,
    maxRounds,
    stopReason,
    goalMode,
    autoExportPortable,
    rounds,
  },
  currentStage,
  status,
  nextStepHint,
  currentSummary,
  generatedArtifacts,
}
```

- [ ] **Step 4: Add end-to-end tool tests**

Adapt the legacy acceptance tests to current structured output and split modules. Required cases:

1. `signature-only` runs locator -> search -> extract, stops after three rounds, and generates only `function-slice.json` from the analysis set.
2. `pure-draft` adds understand/deobfuscate, stops after four rounds, and creates six analysis/draft artifacts.
3. `port-ready` returns `export_portable_bundle` in `continuation.invoke` with `{taskId, artifactMode:'pure'}`.
4. `port-ready + autoExportPortable:true` creates `run/portable.js` in the same call.
5. A missing debugger runtime returns `checkpoint_required`, `retryable:true`, and a preserved failed checkpoint.
6. Two ambiguous source matches stop as `stalled` without choosing an arbitrary script.

Reuse sanitized `example.com` sources only.

- [ ] **Step 5: Create the workflow manifest and regenerate the index**

```typescript
export const manifest = {
  name: 'reverse',
  description: 'Persistent reverse-task lifecycle and bounded agent tools.',
  profile: 'workflow',
  dependencies: ['analyzer', 'debugger', 'rebuild'],
  tools: [
    {modulePath: './reverse/start.js', handlerName: 'startReverseTaskTool'},
    {modulePath: './reverse/manage.js', handlerName: 'manageReverseTaskTool'},
    {
      modulePath: './reverse/orchestrate.js',
      handlerName: 'orchestrateReverseTaskTool',
    },
    {modulePath: './reverse/runAgent.js', handlerName: 'runReverseAgentTool'},
  ],
} satisfies DomainManifest;
```

Run:

```bash
npm run build:index
```

Expected: `Generated ... manifests with ... tools`, with a `reverseManifest` import and four reverse entries in the generated index.

- [ ] **Step 6: Run focused public-surface tests**

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/reverse/manifest.test.js build/tests/unit/tools/reverse-agent-tools.test.js
```

Expected: all six flow cases and manifest registration pass.

- [ ] **Step 7: Optional checkpoint commit**

```bash
git add src/tools/reverse src/tools/generated-tools-index.ts tests/unit/tools/reverse tests/unit/tools/reverse-agent-tools.test.ts
git commit -m "feat(tools): expose bounded reverse agent workflow"
```

---

### Task 8: Lock the response contract and document the operating boundary

**Files:**

- Modify: `docs/reference/reverse-agent-response.schema.json`
- Modify: `docs/guides/reverse-task-orchestration.md`
- Modify: `tests/unit/tools/reverse-agent-tools.test.ts`

- [ ] **Step 1: Add schema assertions to the end-to-end tests**

For compact and verbose output, assert:

```typescript
assert.equal(payload.schemaVersion, '1.0');
assert.ok(['success', 'partial', 'blocked'].includes(payload.outcome));
assert.equal(typeof payload.continuation.ready, 'boolean');
assert.equal(typeof payload.run.roundsExecuted, 'number');
assert.equal(typeof payload.run.stopReason, 'string');
assert.ok(Array.isArray(payload.generatedArtifacts));
```

For compact output, also assert `summary` and `agentGuidance` are omitted while the six fields above remain.

- [ ] **Step 2: Extend the JSON Schema with concrete runner definitions**

Add `$defs.stopReason`, `$defs.goalMode`, `$defs.round`, and `$defs.run`, then add these top-level properties:

```json
"taskId": {"type": "string", "minLength": 1},
"run": {"$ref": "#/$defs/run"},
"currentStage": {"type": "string"},
"status": {"type": "string"},
"nextStepHint": {"type": "string"},
"currentSummary": {"type": "string"},
"generatedArtifacts": {
  "type": "array",
  "items": {"type": "string"},
  "uniqueItems": true
}
```

Do not make `run` required for manage/orchestrate responses because this schema is still shared by the agent-facing family. Add this exact conditional requirement instead:

```json
"allOf": [
  {
    "if": {"required": ["run"]},
    "then": {
      "required": [
        "taskId",
        "run",
        "currentStage",
        "status",
        "nextStepHint",
        "currentSummary",
        "generatedArtifacts"
      ]
    }
  }
]
```

- [ ] **Step 3: Document the new call path and non-goals**

Add a `run_reverse_agent` section with:

- a start call;
- `signature-only`, `pure-draft`, and `port-ready` examples;
- stop-reason table and resume guidance;
- `maxRounds` cap and stall behavior;
- the statement that it reuses deterministic task orchestration and does not import Browser Use or add an LLM planner;
- the initial non-goals: semantic DOM, multi-action batching, visual grounding, and indefinite self-retry.

Correct any examples that still imply unavailable local CLI process-management commands; keep the supported MCP/worker contract authoritative.

- [ ] **Step 4: Validate docs and focused tests**

```bash
node -e "JSON.parse(require('node:fs').readFileSync('docs/reference/reverse-agent-response.schema.json','utf8')); console.log('schema json ok')"
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/reverse-agent-tools.test.js
```

Expected: `schema json ok` and all end-to-end tests pass.

- [ ] **Step 5: Optional checkpoint commit**

```bash
git add docs/reference/reverse-agent-response.schema.json docs/guides/reverse-task-orchestration.md tests/unit/tools/reverse-agent-tools.test.ts
git commit -m "docs(reverse): define bounded agent response contract"
```

---

### Task 9: Final-diff verification and handoff

**Files:** all files changed by Tasks 1-8.

- [ ] **Step 1: Regenerate the tool index one final time**

```bash
npm run build:index
```

Expected: generation succeeds and a second immediate run produces no additional diff.

- [ ] **Step 2: Run focused reverse-task checks after the final code change**

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/reverse/ReverseTaskExecutionError.test.js build/tests/unit/reverse/ExecutionAdapters.test.js build/tests/unit/reverse/ReverseAgentRunner.test.js build/tests/unit/reverse/PureExtractionDraft.test.js build/tests/unit/tools/reverse-analysis-tools.test.js build/tests/unit/tools/rebuild/portable.test.js build/tests/unit/tools/reverse/manifest.test.js build/tests/unit/tools/reverse-agent-tools.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Run project-required final checks**

```bash
npm run typecheck
npm run test:unit
npm run check-format
```

Expected: all exit 0. If an unrelated pre-existing failure appears, record the exact command, failing file, and why it is outside this diff; do not report the implementation as fully verified until all failures attributable to this diff are fixed and rerun.

- [ ] **Step 4: Inspect only the final relevant diff**

```bash
git status --short
git diff -- src/reverse src/modules/debugger/DebuggerManager.ts src/tools/analyzer src/tools/debugger src/tools/rebuild src/tools/reverse src/tools/generated-tools-index.ts tests/unit/reverse tests/unit/tools/reverse-analysis-tools.test.ts tests/unit/tools/rebuild tests/unit/tools/reverse docs/reference/reverse-agent-response.schema.json docs/guides/reverse-task-orchestration.md
```

Confirm:

- no secret, cookie, storage snapshot, production host, or real task artifact is present;
- no generated file was manually edited;
- no eager CDP or stealth injection was added;
- all orchestrator-planned tools have adapters;
- all stop paths are tested and log once;
- unrelated user changes remain untouched.

- [ ] **Step 5: Optional final commit**

```bash
git add src/reverse src/modules/debugger/DebuggerManager.ts src/tools/analyzer src/tools/debugger src/tools/rebuild src/tools/reverse src/tools/generated-tools-index.ts tests/unit/reverse tests/unit/tools/reverse-analysis-tools.test.ts tests/unit/tools/rebuild tests/unit/tools/reverse docs/reference/reverse-agent-response.schema.json docs/guides/reverse-task-orchestration.md
git commit -m "feat(reverse): add bounded one-shot reverse agent"
```

## Deferred Expansion After This Slice

Only evaluate these after the vertical slice is exercised on sanitized real tasks:

1. Browser Use-style event stream and replay viewer, if timeline/runtime-evidence proves insufficient for debugging.
2. Consecutive-failure budgets per action, if one-stop checkpoint behavior creates too much manual resume work.
3. Sensitive-data filtering at artifact boundaries, before any remote telemetry or shared task store is added.
4. Human approval gates for navigation, form submission, or other externally mutating browser actions.
5. Semantic DOM/action modeling and multi-action batches, only if reverse workflows begin to require autonomous UI exploration rather than source/evidence analysis.

These are deliberately not part of the first implementation because the current task state machine, adapter registry, checkpoint store, and evidence logs already cover the minimum useful mechanism.
