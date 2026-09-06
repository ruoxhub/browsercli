# WASM Tool Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing WASM collector, make browser memory inspection bounded and side-effect safe, and return actionable native-tool failures.

**Architecture:** Keep the fix inside `src/tools/wasm`: a thin `collect_wasm` adapter delegates to `WasmCollector`, memory inspection uses a descriptor-only frame probe with an operation timeout, and one `execFile` wrapper supplies consistent native command results. No Worker API or proxycli cancellation changes are required.

**Tech Stack:** TypeScript ESM, Node `execFile`, Patchright Frame evaluation, Zod, `node:test`.

## Global Constraints

- Preserve the default zero-JavaScript-injection browser startup path.
- Add no dependency and do not modify generated `build/` output by hand.
- Preserve unrelated dirty-worktree changes, especially Worker/API/proxycli files.
- Use TDD and run focused checks after every production change.
- Do not create a git commit unless the user explicitly requests one.

---

### Task 1: Expose the existing WASM collector

**Files:**

- Create: `src/tools/wasm/collectWasm.ts`
- Modify: `src/modules/wasm/WasmCollector.ts`
- Modify: `src/tools/wasm/index.ts`
- Modify: `src/tools/wasm/manifest.ts`
- Modify: `src/tools/wasm/types.ts`
- Test: `tests/unit/tools/wasm/wasmTools.test.ts`

**Interfaces:**

- Consumes: `WasmCollector.collect(options: CollectWasmOptions): Promise<WasmDetectionResult>`.
- Produces: exported `collectWasm` ToolDefinition named `collect_wasm`; exported `CollectWasmOptions`; `WasmCollectData` result type.

- [ ] **Step 1: Write the failing manifest and delegation tests**

```ts
assert.ok(wasmManifest.tools.some(item => item.handlerName === 'collectWasm'));
await collectWasm.handler(
  {params: {url: 'https://example.test/wasm', timeout: 1234}},
  output.response,
  {} as Context,
);
assert.deepEqual(receivedOptions, {
  url: 'https://example.test/wasm',
  timeout: 1234,
});
assert.equal(synchronizedPage, selectedPage);
assert.equal(output.content.success, true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js`

Expected: compilation/import failure because `collectWasm` does not exist.

- [ ] **Step 3: Add the thin tool adapter**

```ts
export const collectWasm = defineTool({
  name: 'collect_wasm',
  annotations: {
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().url(),
    timeout: zod.number().int().positive().optional(),
    waitAfterLoadMs: zod.number().int().nonnegative().optional(),
    includeRuntimeEvents: zod.boolean().optional(),
    maxModules: zod.number().int().positive().optional(),
    captureBase64: zod.boolean().optional(),
  },
  handler: async (request, response, context) => {
    const runtime = getRuntime();
    runtime.syncPageContext(context.getSelectedPage());
    const result = await withOperationTimeout(
      runtime.wasmCollector.collect(request.params),
      '收集 WASM',
      request.params.timeout ?? 30000,
    );
    response.setStructuredContent({
      success: true,
      message: `捕获 ${result.totalModules} 个 WASM 模块、${result.totalRuntimeEvents} 个运行时事件`,
      tooltype: 'collect_wasm',
      logFormat: 'json',
      data: result,
    });
  },
});
```

Catch errors in the handler and return `收集 WASM 失败：<message>`. Export the tool and add it between capabilities and dump in the manifest.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js`

Expected: collector tests pass.

### Task 2: Make memory inspection safe and bounded

**Files:**

- Modify: `src/tools/wasm/wasmMemoryInspect.ts`
- Modify: `src/tools/wasm/types.ts`
- Test: `tests/unit/tools/wasm/wasmTools.test.ts`

**Interfaces:**

- Consumes: `Context.getSelectedFrame()` and `withOperationTimeout(operation, label, timeoutMs)`.
- Produces: descriptor-only memory probe; optional `timeoutMs`; `searchTruncated` in `WasmMemoryInspectData`.

- [ ] **Step 1: Write failing getter-safety and timeout tests**

```ts
Object.defineProperty(globalThis, 'dangerous', {
  enumerable: true,
  get() {
    globalThis.getterCalls += 1;
    throw new Error('getter must not run');
  },
});
globalThis.exports = {memory: new WebAssembly.Memory({initial: 1})};
await wasmMemoryInspect.handler(
  {params: {offset: 0, length: 8, format: 'hex', timeoutMs: 50}},
  output.response,
  context,
);
assert.equal(readGetterCalls(), 0);
assert.equal(output.content.success, true);
```

Add a second context whose `evaluate()` returns a never-settling Promise. Race the handler against 200 ms and assert that it completes with a message containing `超时`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js`

Expected: current implementation invokes the getter and ignores the requested timeout.

- [ ] **Step 3: Replace recursive value access with data descriptors**

Inside the page callback, inspect descriptors without reading accessors:

```ts
const descriptors = Object.getOwnPropertyDescriptors(globalThis);
for (const [name, descriptor] of Object.entries(descriptors)) {
  if (!('value' in descriptor)) continue;
  inspectValue(name, descriptor.value);
}
```

`inspectValue()` records direct `WebAssembly.Memory`, handles `WebAssembly.Instance.exports`, and inspects one level of own data descriptors for ordinary objects. Use a `Set<WebAssembly.Memory>` to deduplicate values; skip `globalThis` to avoid rescanning it. Never inspect prototypes or invoke accessors.

Evaluate through the selected Frame:

```ts
const result = await withOperationTimeout(
  context.getSelectedFrame().evaluate(memoryProbe, params),
  '检查 WASM 内存',
  timeoutMs,
);
```

Reject offsets above `buffer.byteLength`. Limit pattern search to 64 MiB and return `searchTruncated: true` when the memory is larger.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js`

Expected: memory lookup succeeds, getter count stays zero, and the never-settling evaluation returns a structured timeout failure.

### Task 3: Unify native command failures

**Files:**

- Create: `src/tools/wasm/nativeCommand.ts`
- Modify: `src/tools/wasm/wasmCapabilities.ts`
- Modify: `src/tools/wasm/wasmOfflineRun.ts`
- Modify: `src/tools/wasm/wasmOptimize.ts`
- Test: `tests/unit/tools/wasm/wasmTools.test.ts`

**Interfaces:**

- Produces: `runNativeCommand(command: string, args: string[], timeoutMs: number): Promise<NativeCommandResult>`.
- `NativeCommandResult`: `{stdout: string; stderr: string; exitCode: number; notFound: boolean; timedOut: boolean}`.

- [ ] **Step 1: Write failing missing-runtime tests**

Create a temporary valid input file, save `process.env.PATH`, set PATH to an empty temporary directory, and restore it in `finally`.

```ts
await wasmOfflineRun.handler(
  {params: {inputPath, functionName: 'encrypt', runtime: 'auto'}},
  offlineOutput.response,
  {} as Context,
);
assert.match(offlineOutput.content.message, /wasmtime/);
assert.match(offlineOutput.content.message, /wasmer/);

await wasmOptimize.handler(
  {params: {inputPath}},
  optimizeOutput.response,
  {} as Context,
);
assert.match(optimizeOutput.content.message, /wasm-opt/);
assert.match(optimizeOutput.content.message, /未找到/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js`

Expected: existing messages end after the colon and auto fallback does not reliably use `notFound`.

- [ ] **Step 3: Implement one `execFile` adapter**

```ts
export function runNativeCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<NativeCommandResult> {
  return new Promise(resolve => {
    execFile(command, args, {timeout: timeoutMs}, (error, stdout, stderr) => {
      const nativeError = error as NativeCommandError | null;
      resolve({
        stdout: stdout ?? '',
        stderr: (stderr ?? '').trim() || nativeError?.message || '',
        exitCode:
          typeof nativeError?.code === 'number'
            ? nativeError.code
            : error
              ? 1
              : 0,
        notFound: nativeError?.code === 'ENOENT',
        timedOut: nativeError?.killed === true,
      });
    });
  });
}
```

Delete both local `runCommand()` copies. In auto mode, fallback only when `result.notFound`; if both are missing, return `系统中未找到 wasmtime 或 wasmer` with both attempts in data. For optimize, return `系统中未找到 wasm-opt，请先安装 Binaryen`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run build:dev -- --ignore "src/web-ui/**"` followed by `node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js`

Expected: all WASM unit tests pass with actionable error messages.

### Task 4: Final verification and live regression

**Files:**

- Verify only all files listed above.

**Interfaces:**

- Consumes: final working tree and local Worker/proxycli runtime.
- Produces: fresh verification evidence tied to the final diff.

- [ ] **Step 1: Inspect the scoped diff**

Run: `git diff -- src/modules/wasm/WasmCollector.ts src/tools/wasm tests/unit/tools/wasm docs/superpowers/specs/2026-08-15-wasm-tool-reliability-design.md docs/superpowers/plans/2026-08-15-wasm-tool-reliability.md`

Expected: no unrelated Worker/API/proxycli edits.

- [ ] **Step 2: Run static and focused checks**

Run:

```text
npm run typecheck
npm run build:dev -- --ignore "src/web-ui/**"
node --require ./build/tests/setup.js --test build/tests/unit/tools/wasm/wasmTools.test.js build/tests/unit/modules/wasm/*.test.js
npm run check-format
```

Expected: all commands pass, or pre-existing unrelated failures are recorded with evidence.

- [ ] **Step 3: Rebuild and restart the local Worker safely**

Verify the process listening on port 8765 belongs to `build/src/index.js` before stopping it. Start the rebuilt Worker hidden and confirm `/api/v1/health` and the tool list expose `collect_wasm`.

- [ ] **Step 4: Run the target-page regression**

Use `https://www.mashangpa.com/problem-detail/11/`:

```text
collect_wasm --url https://www.mashangpa.com/problem-detail/11/
wasm_dump --moduleIndex 0
wasm_memory_inspect --offset 0 --length 32 --format both
wasm_vmp_trace
wasm_offline_run ... --runtime auto
wasm_optimize ...
```

Expected: collect/dump/memory/trace complete without leaving Worker busy. Missing native runtimes return explicit dependency messages rather than blank errors.

- [ ] **Step 5: Re-run checks after any final correction**

Run the exact checks from Step 2 after the last code edit. Do not report completion using earlier results.
