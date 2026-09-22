# Stuck Worker Job Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a debugger-paused page cannot leave a `fill` job permanently running or prevent an explicit browser disconnect from recovering the Worker.

**Architecture:** Bound form operations at the selected `Frame`, then propagate an `AbortSignal` from the HTTP job through `ToolAdapter` and `ToolExecutionPipeline`. The API owns the job deadline and exposes cancellation; normal browser lifecycle serialization remains unchanged, while an explicit force-disconnect aborts the active HTTP job and bypasses only the lifecycle guard needed for recovery.

**Tech Stack:** TypeScript ESM, Patchright, native `AbortController`, Node.js `node:test`, existing `/api/v1` HTTP client.

## Global Constraints

- Preserve every pre-existing worktree change and edit only the files listed below.
- Do not add dependencies, commit, push, or modify generated `build/` output.
- Keep normal connect/disconnect mutually exclusive with tool execution.
- Force-disconnect must require an explicit `force: true` request or `--force` CLI flag.
- The default server job deadline is exactly `300_000` ms, matching the current browsercli timeout.
- Timed-out and cancelled jobs are terminal and retain an error code/message plus `finishedAt`.

---

### Task 1: Bound Form Operations on the Selected Frame

**Files:**

- Create: `src/tools/input/fillElement.ts`
- Modify: `src/tools/input/fill.ts`
- Modify: `src/tools/input/fillForm.ts`
- Create: `tests/unit/tools/input/fill.test.ts`

**Interfaces:**

- Produces: `fillElement(frame: Frame, selector: string, value: string, timeoutMs?: number): Promise<{found: boolean; isSelect: boolean}>`
- Consumes: existing `withOperationTimeout()` from `src/tools/shared/browserRuntime.ts`

- [ ] **Step 1: Write failing selected-frame and timeout tests**

```ts
it('fills through the selected frame without falling back to page()', async () => {
  const calls: string[] = [];
  const frame = {
    $: async () => ({fill: async () => calls.push('fill')}),
    evaluate: async () => false,
    page: () => {
      throw new Error('page() must not be used');
    },
  };

  assert.deepEqual(await fillElement(frame as never, '#name', 'alice', 20), {
    found: true,
    isSelect: false,
  });
  assert.deepEqual(calls, ['fill']);
});

it('rejects a debugger-stalled frame operation at its deadline', async () => {
  const frame = {$: async () => await new Promise(() => undefined)};
  await assert.rejects(
    fillElement(frame as never, '#name', 'alice', 10),
    /超时 \(10ms\)/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/input/fill.test.js
```

Expected: compilation or import fails because `fillElement.ts` does not exist.

- [ ] **Step 3: Implement the shared bounded operation**

```ts
const DEFAULT_FILL_TIMEOUT_MS = 10_000;

export async function fillElement(
  frame: Frame,
  selector: string,
  value: string,
  timeoutMs = DEFAULT_FILL_TIMEOUT_MS,
): Promise<{found: boolean; isSelect: boolean}> {
  const element = await withOperationTimeout(
    frame.$(selector),
    '查找表单元素',
    timeoutMs,
  );
  if (!element) return {found: false, isSelect: false};
  const isSelect = await withOperationTimeout(
    frame.evaluate(
      sel => document.querySelector(sel)?.tagName === 'SELECT',
      selector,
    ),
    '检测表单元素类型',
    timeoutMs,
  );
  await withOperationTimeout(
    isSelect
      ? element.selectOption(value, {timeout: timeoutMs})
      : element.fill(value, {timeout: timeoutMs}),
    '填充表单元素',
    timeoutMs,
  );
  return {found: true, isSelect};
}
```

- [ ] **Step 4: Replace duplicated `page.$/page.evaluate/fill` flows in both tools**

Both handlers call `fillElement(frame, selector, value)`. `fill` preserves its not-found response; `fill_form` preserves its filled count and skips missing elements.

- [ ] **Step 5: Run the focused test and verify GREEN**

Use the command from Step 2; expect all tests in `fill.test.js` to pass.

---

### Task 2: Make Tool Activity Abortable and Add Terminal Job States

**Files:**

- Modify: `src/worker/WorkerActivityCoordinator.ts`
- Modify: `src/worker/ToolExecutionPipeline.ts`
- Modify: `src/worker/ToolAdapter.ts`
- Modify: `src/worker/JobStore.ts`
- Create: `tests/unit/worker/WorkerActivityCoordinator.test.ts`
- Modify: `tests/unit/worker/ToolAdapter.test.ts`
- Modify: `tests/unit/web/JobStore.test.ts`

**Interfaces:**

- Produces: `raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T>`
- Changes: `runTool(action, signal?)`, `ToolExecutionPipeline.execute(meta, params, signal?)`, and `ToolAdapter.executeTool(meta, params, sessionId?, signal?)`
- Changes: job status union adds `timed_out | cancelled`; `JobStore.markTimedOut()` and `JobStore.cancel()` finalize those states.

- [ ] **Step 1: Write failing abort-release tests**

```ts
it('releases the tool slot when a hung action is aborted', async () => {
  const coordinator = new WorkerActivityCoordinator();
  const controller = new AbortController();
  const reason = new Error('cancelled');
  const running = coordinator.runTool(
    async () => await new Promise(() => undefined),
    controller.signal,
  );
  controller.abort(reason);
  await assert.rejects(running, error => error === reason);
  assert.equal(coordinator.getState().activeTools, 0);
});
```

Add a `ToolAdapter.executeTool()` test whose frame handler never resolves, abort it, and assert the global activity count returns to zero.

- [ ] **Step 2: Write failing JobStore terminal-state tests**

```ts
const timedOut = store.create('s', 't', {});
store.markTimedOut(timedOut.jobId, {code: 'JOB_TIMEOUT', message: 'deadline'});
assert.equal(store.get(timedOut.jobId).status, 'timed_out');

const cancelled = store.create('s', 't', {});
store.cancel(cancelled.jobId, {code: 'JOB_CANCELLED', message: 'cancelled'});
assert.equal(store.get(cancelled.jobId).status, 'cancelled');
```

- [ ] **Step 3: Run Worker tests and verify RED**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/worker/WorkerActivityCoordinator.test.js build/tests/unit/worker/ToolAdapter.test.js build/tests/unit/web/JobStore.test.js
```

Expected: missing signal parameters and missing JobStore methods fail.

- [ ] **Step 4: Implement abort propagation and one-time activity release**

`raceWithAbort()` rejects with `signal.reason`, removes its event listener in `finally`, and does not invoke an already-aborted action. Pipeline and Adapter pass the same optional signal without changing existing call sites.

- [ ] **Step 5: Implement terminal JobStore transitions**

Use one private finalizer for `failed`, `timed_out`, and `cancelled`; capacity eviction treats all four terminal states (`done`, `failed`, `timed_out`, `cancelled`) as removable and never evicts `pending`/`running`.

- [ ] **Step 6: Run the Worker tests and verify GREEN**

Use the command from Step 3; expect all selected tests to pass.

---

### Task 3: Add Server Deadline, Job Cancellation, and Force Disconnect

**Files:**

- Modify: `src/web/routes/apiV1.ts`
- Modify: `src/worker/BrowserConnectionManager.ts`
- Modify: `tests/unit/web/routes/apiV1.test.ts`
- Modify: `tests/unit/web/routes/apiV1.browser.test.ts`
- Modify: `tests/unit/worker/BrowserConnectionManager.test.ts`

**Interfaces:**

- `ApiV1Options` adds `jobTimeoutMs?: number` with a `300_000` ms default.
- Adds `POST /api/v1/jobs/:id/cancel` returning the terminal job.
- `POST /api/v1/browser/disconnect` accepts `{force?: boolean}`.
- `disconnectBrowser(contextProvider, {force?: boolean})` bypasses the activity guard only when forced.

- [ ] **Step 1: Write a failing server-deadline test**

Create routes with `{jobTimeoutMs: 20}`, submit an adapter promise that never settles, poll the JobStore, and assert `status === 'timed_out'`, `error.code === 'JOB_TIMEOUT'`, and that a subsequent invoke returns 202.

- [ ] **Step 2: Write a failing cancel-route test**

Submit a never-settling job, call `POST /api/v1/jobs/:id/cancel`, assert a 200 response with `status === 'cancelled'` and `error.code === 'JOB_CANCELLED'`, then assert a new invoke is accepted.

- [ ] **Step 3: Write a failing force-disconnect test**

Assert ordinary disconnect still returns `409 WORKER_BUSY` during a job. Then send `{force: true}`, assert the job becomes cancelled, `BrowserManager.resetInstance()` runs, and the response is disconnected. Add a manager-level test proving `force: true` bypasses an unrelated active tool guard.

- [ ] **Step 4: Run focused API/browser tests and verify RED**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/web/routes/apiV1.test.js build/tests/unit/web/routes/apiV1.browser.test.js build/tests/unit/worker/BrowserConnectionManager.test.js
```

- [ ] **Step 5: Implement one active-job handle and deadline**

```ts
interface ActiveJob {
  jobId: string;
  controller: AbortController;
  execution: Promise<void>;
}

const controller = new AbortController();
const execution = runJob(
  deps,
  job.jobId,
  meta,
  params,
  sessionId,
  controller,
  jobTimeoutMs,
).finally(() => {
  if (activeJob?.jobId === job.jobId) activeJob = undefined;
});
activeJob = {jobId: job.jobId, controller, execution};
```

`runJob()` races the adapter promise with the signal, aborts at the deadline, records `timed_out`/`cancelled`, and clears its timer.

- [ ] **Step 6: Implement cancellation and forced disconnect**

Cancellation aborts and awaits the active execution before returning its terminal record. Force-disconnect aborts an active HTTP job, waits for its bounded execution to unwind, then calls `disconnectBrowser(..., {force: true})`; ordinary disconnect keeps the existing busy rejection.

- [ ] **Step 7: Run focused tests and verify GREEN**

Use the command from Step 4; expect all selected tests to pass.

---

### Task 4: Expose Recovery Through browsercli

**Files:**

- Modify: `browsercli/src/WorkerHttpClient.ts`
- Modify: `browsercli/src/commands/browser.ts`
- Modify: `browsercli/src/help.ts`
- Modify: `browsercli/tests/unit/WorkerHttpClient.test.ts`
- Modify: `browsercli/tests/unit/WorkerHttpClient.browser.test.ts`
- Modify: `browsercli/tests/unit/browser.test.ts`
- Modify: `browsercli/tests/unit/help.test.ts`
- Modify: `skills/browsercli/SKILL.md`

**Interfaces:**

- Job status adds `timed_out | cancelled`.
- Adds `cancelJob(jobId): Promise<JobStatus>`.
- `disconnectBrowser(options?: {force?: boolean})` sends JSON only when force is requested.
- `browsercli browser disconnect --force` is the explicit recovery command.

- [ ] **Step 1: Write failing HTTP-client contract tests**

Assert `cancelJob('job_1')` posts to `/api/v1/jobs/job_1/cancel`; assert forced disconnect posts `{force: true}`; assert `invoke()` throws for `timed_out` and `cancelled` jobs rather than returning `undefined`.

- [ ] **Step 2: Write failing command/help tests**

```ts
await browserCommand(['disconnect', '--force'], ctx);
assert.deepEqual(calls, [{action: 'disconnect', options: {force: true}}]);
assert.ok(helpText.includes('browser disconnect [--force] [--json]'));
```

- [ ] **Step 3: Run browsercli tests and verify RED**

```powershell
npm --prefix browsercli test
```

- [ ] **Step 4: Implement the minimal client, flag, and help changes**

Keep status strict (`--force` invalid for status), omit the disconnect body for the default path, and document that force cancels the active HTTP job before detaching the browser.

- [ ] **Step 5: Run browsercli tests and verify GREEN**

Use the command from Step 3; expect all browsercli tests to pass.

---

### Task 5: Final Diff Verification

**Files:** Review only files changed by Tasks 1–4.

- [ ] **Step 1: Inspect the scoped diff and run `git diff --check`**

- [ ] **Step 2: Run focused Worker and browsercli regressions after the last edit**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/input/fill.test.js build/tests/unit/worker/WorkerActivityCoordinator.test.js build/tests/unit/worker/ToolAdapter.test.js build/tests/unit/worker/BrowserConnectionManager.test.js build/tests/unit/web/JobStore.test.js build/tests/unit/web/routes/apiV1.test.js build/tests/unit/web/routes/apiV1.browser.test.js
npm --prefix browsercli test
```

- [ ] **Step 3: Run repository gates**

```powershell
npm run typecheck
npm run test:unit
npm run check-format
npm --prefix browsercli run typecheck
```

- [ ] **Step 4: Re-read the final diff**

Confirm normal disconnect still rejects busy work, force is explicit, every new terminal status has `finishedAt`, and no pre-existing worktree edit was reverted.
