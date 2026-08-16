# V8 Inspector Module Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `open-source/jshookmcp/src/modules/v8-inspector` into the current project as an opt-in TypeScript module with behavior-preserving tests.

**Architecture:** Keep the upstream module boundary intact under `src/modules/v8-inspector`: pure heap/TurboFan parsers remain independent of browser state, CDP helpers receive a lazy page getter or page value, and host-side execution of captured source requires an explicit unsafe opt-in. Adapt imports to this repository's ESM conventions, use the project's Patchright `page.context().newCDPSession(page)` contract, and route temporary TurboFan files through the existing artifact-root resolver; do not migrate the upstream server/domain handlers or modify browser startup.

**Tech Stack:** TypeScript ESM, Node.js child processes and filesystem APIs, Chrome DevTools Protocol, `node:test`, `node:assert/strict`.

## Global Constraints

- Preserve the default zero-JavaScript-injection and lazy-CDP-domain startup path.
- Add no dependency and do not modify generated `build/` output by hand.
- Preserve unrelated dirty-worktree changes, especially existing debugger, collector, WASM, worker, and browsercli edits.
- Keep the public source-module names and exports compatible with jshookmcp.
- Use `.js` suffixes for relative ESM imports in TypeScript source.
- Use TDD: every production batch starts with a focused failing test and ends with the same test passing.
- Do not create a git commit unless the user explicitly requests one.

---

### Task 1: Migrate pure heap and TurboFan parsers

**Files:**

- Create: `src/modules/v8-inspector/DominatorTreeBuilder.ts`
- Create: `src/modules/v8-inspector/HeapSnapshotParser.ts`
- Create: `src/modules/v8-inspector/TurboFanGraphParser.ts`
- Test: `tests/unit/modules/v8-inspector/DominatorTreeBuilder.test.ts`
- Test: `tests/unit/modules/v8-inspector/HeapSnapshotParser.test.ts`
- Test: `tests/unit/modules/v8-inspector/TurboFanGraphParser.test.ts`

**Interfaces:**

- Produces: `DominatorTreeBuilder.buildDominatorTree(nodes, edges): DominatorNode` and leak/retainer queries.
- Produces: `HeapSnapshotParser` constructor/chunk parser, node/edge queries, retained-size analysis, diff, summary, and `analyzeHeap()`.
- Produces: `parseTurboFanJSON(raw): TurboFanIRGraph | null` and `parseTurboFanJSONFiles(files): ParsedTurboFanResult`.

- [ ] **Step 1: Write failing parser contract tests**

Use literal fixtures so expected values do not share implementation logic. The heap test must cover a standard snapshot split across chunks and verify node IDs, the edge target, and retained sizes. The dominator test must cover a diamond/cross-edge graph and a detached-node leak. The TurboFan test must cover function metadata, graph and schedule phases, opcode counts, and invalid JSON.

```ts
const parser = new HeapSnapshotParser();
parser.feedChunk([snapshot.slice(0, splitAt), snapshot.slice(splitAt)]);
assert.deepEqual(parser.parseNodes(), [
  {id: 1, name: '(root)', selfSize: 10, type: 'synthetic'},
  {id: 2, name: 'Widget', selfSize: 20, type: 'object'},
]);
assert.deepEqual(parser.getAllRetainedSizes(), [
  {id: 1, retainedSize: 30},
  {id: 2, retainedSize: 20},
]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/modules/v8-inspector/HeapSnapshotParser.test.js build/tests/unit/modules/v8-inspector/DominatorTreeBuilder.test.js build/tests/unit/modules/v8-inspector/TurboFanGraphParser.test.js`

Expected: compilation fails because `src/modules/v8-inspector` does not exist.

- [ ] **Step 3: Add the three pure implementations**

Port the upstream algorithms without introducing a new shared abstraction. Keep the type-only cycle explicit:

```ts
import type {ParsedEdge, ParsedNode} from './HeapSnapshotParser.js';
import {
  DominatorTreeBuilder,
  type DominatorNode,
} from './DominatorTreeBuilder.js';
```

Preserve standard JSON and line-format heap parsing, the Lengauer-Tarjan dominator calculation, leak heuristics, and TurboFan graph parsing.

- [ ] **Step 4: Run the same focused tests and verify GREEN**

Expected: all three parser test files pass with no warnings.

### Task 2: Migrate CDP-backed inspection helpers

**Files:**

- Create: `src/modules/v8-inspector/VersionDetector.ts`
- Create: `src/modules/v8-inspector/V8InspectorClient.ts`
- Create: `src/modules/v8-inspector/CDPSessionAdapter.ts`
- Create: `src/modules/v8-inspector/NativeBytecodePrinter.ts`
- Create: `src/modules/v8-inspector/BytecodeExtractor.ts`
- Create: `src/modules/v8-inspector/JITInspector.ts`
- Test: `tests/unit/modules/v8-inspector/RuntimeInspectors.test.ts`
- Test: `tests/unit/modules/v8-inspector/NativeBytecodePrinter.test.ts`

**Interfaces:**

- Consumes: a lazy `getPage?: () => Promise<unknown>` whose resolved Patchright page exposes `context().newCDPSession(page)`; the adapter retains legacy upstream compatibility.
- Produces: browser/Node V8 version detection, heap-profiler operations, pseudo/native bytecode extraction, JIT tier inspection, and explicit `dispose()` cleanup.
- Preserves: no CDP domain is enabled until the corresponding public method is called.

- [ ] **Step 1: Write failing fake-CDP and isolated-process tests**

Exercise real module behavior through a small session double. Assert method sequences and consumer-visible results, not the double itself.

```ts
const client = new V8InspectorClient(async () => page);
assert.deepEqual(await client.getHeapUsage(), {
  jsHeapSizeUsed: 128,
  jsHeapSizeTotal: 256,
  jsHeapSizeLimit: 512,
});

const detector = new VersionDetector(async () => page);
assert.deepEqual(await detector.detectV8Version(), {
  major: 12,
  minor: 0,
  patch: 226,
  commit: '10',
});
```

Also verify bytecode disassembly formats, pseudo-bytecode extraction from `Debugger.getScriptSource`, JIT TurboFan/Maglev status mapping, heap snapshot chunk byte counting, and one real isolated `--print-bytecode` call for a simple function.

- [ ] **Step 2: Run the focused tests and verify RED**

Run the build command from Task 1, then: `node --require ./build/tests/setup.js --test build/tests/unit/modules/v8-inspector/RuntimeInspectors.test.js build/tests/unit/modules/v8-inspector/NativeBytecodePrinter.test.js`

Expected: compilation fails on missing runtime-inspector modules.

- [ ] **Step 3: Add the five CDP/native implementations**

Port the upstream implementations and replace alias imports with local ESM imports:

```ts
import {printNativeIgnitionBytecode} from './NativeBytecodePrinter.js';
import {VersionDetector} from './VersionDetector.js';
```

Keep page/session validation local, detach owned sessions in `finally`, remove listeners after heap snapshots on both success and failure, and retain compatibility fallbacks for heap usage.

- [ ] **Step 4: Run the same focused tests and verify GREEN**

Expected: CDP contract tests and isolated bytecode test pass.

### Task 3: Migrate WASM GC and TurboFan collection entry points

**Files:**

- Create: `src/modules/v8-inspector/WasmGcInspector.ts`
- Create: `src/modules/v8-inspector/TurboFanTraceCollector.ts`
- Create: `src/modules/v8-inspector/index.ts`
- Test: `tests/unit/modules/v8-inspector/WasmGcInspector.test.ts`
- Test: `tests/unit/modules/v8-inspector/TurboFanTraceCollector.test.ts`
- Test: `tests/unit/modules/v8-inspector/index.test.ts`

**Interfaces:**

- Produces: `discoverWasmScripts(page)` and `inspectWasmGc(page, options)` with owned-session cleanup.
- Produces: `collectTurboFanIRIsolated(context, timeoutMs, keepTraceDir, unsafeExecuteCapturedSource)` and `collectTurboFanIRFromDir(traceDir)`.
- Produces: a barrel export matching the upstream module's public names.
- Consumes: `logger` from `src/utils/logger.ts` and `resolveDefaultArtifactsTasksDir(import.meta.url)` from `src/utils/projectPaths.ts`.

- [ ] **Step 1: Write failing WASM, trace-directory, and export tests**

Capture each `Runtime.evaluate` expression in a fake session and validate it as plain JavaScript before returning a literal protocol response:

```ts
new Function(`return (${params.expression});`);
```

This test must fail if browser-side probe strings contain TypeScript-only constructs such as `as any`. For TurboFan, write one literal `turbo-*.json` file under a test temp directory and assert `collectTurboFanIRFromDir()` parses it while ignoring unrelated files. Import every upstream public symbol through `index.js`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run the build command from Task 1, then: `node --require ./build/tests/setup.js --test build/tests/unit/modules/v8-inspector/WasmGcInspector.test.js build/tests/unit/modules/v8-inspector/TurboFanTraceCollector.test.js build/tests/unit/modules/v8-inspector/index.test.js`

Expected: compilation fails on missing modules.

- [ ] **Step 3: Add the two implementations and barrel**

Port the upstream logic. In browser-evaluated template strings, use only plain JavaScript (`r.initiatorType`, `WebAssembly.Struct`, `self[key]`) and keep TypeScript assertions outside the string. Route isolated trace output to a unique directory under:

```ts
const base = join(resolveDefaultArtifactsTasksDir(import.meta.url), '.tmp');
mkdirSync(base, {recursive: true});
return mkdtempSync(join(base, 'v8-turbofan-'));
```

When `keepTraceDir` is false, remove the directory in `finally`; when true, return it to the caller only after successful collection. Isolated execution remains disabled unless `unsafeExecuteCapturedSource` is explicitly true, and the opted-in child uses Node permissions, an empty environment, a bounded heap/output, and a temporary working directory.

- [ ] **Step 4: Run all v8-inspector focused tests and verify GREEN**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/modules/v8-inspector/*.test.js`

Expected: all migrated module tests pass.

### Task 4: Final diff verification

**Files:**

- Inspect: all files added by Tasks 1-3 and this plan only.

**Interfaces:**

- Confirms: no changes to browser startup, existing debugger code, RuntimeServices, worker APIs, generated tool indexes, or `build/` source control state.

- [ ] **Step 1: Format only the migrated files**

Run: `npx prettier --write src/modules/v8-inspector tests/unit/modules/v8-inspector docs/superpowers/plans/2026-08-15-v8-inspector-module-migration.md`

- [ ] **Step 2: Re-run focused tests after the final edit**

Run the all-v8-inspector command from Task 3.

- [ ] **Step 3: Run repository gates against the final diff**

Run: `npm run typecheck`, `npm run test:unit`, and `npm run check-format`.

- [ ] **Step 4: Inspect the final diff and coverage metadata**

Run `git diff --check`, inspect only migration-owned paths, and use codebase-memory coverage/impact checks for the new module. Report any unrelated pre-existing failure separately; do not repair it inside this task.
