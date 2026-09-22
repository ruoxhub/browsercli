# Runtime Recovery UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining usability gaps from the stuck-worker incident without duplicating tools that already exist.

**Architecture:** Keep Worker cancellation in the existing HTTP job layer, expose that state through a small jobs CLI, and reuse `evaluate_script` plus `get_storage` for page execution and Cookie export. DOM operations only bypass an already-observed CDP `debugCommand` pause, so normal breakpoints remain active; every browser operation also receives an explicit Playwright/tool deadline.

**Tech Stack:** TypeScript ESM, Patchright/CDP, native `AbortController`, Node.js `node:test`, existing `/api/v1` HTTP client.

## Global Constraints

- Preserve all pre-existing dirty-worktree changes; never reset or overwrite them.
- Add no dependency and do not edit generated `build/` output by hand.
- Preserve the default zero-JavaScript-injection startup path and do not eagerly enable the Debugger domain.
- Reuse `evaluate_script` and `get_storage`; do not add duplicate `evaluate`, `run_script`, or Cookie tools.
- Worker job cancel is idempotent for terminal jobs; force browser disconnect remains explicit.
- New tool parameters are optional and therefore do not break existing callers.
- The baseline focused suite has three unrelated `ToolAdapter.test.ts` failures; do not hide or rewrite them as part of this plan.

---

### Task 1: Expose Job Listing and Cancellation in browsercli

**Files:**

- Modify: `src/worker/JobStore.ts`
- Modify: `src/web/routes/apiV1.ts`
- Modify: `tests/unit/web/JobStore.test.ts`
- Modify: `tests/unit/web/routes/apiV1.test.ts`
- Modify: `browsercli/src/WorkerHttpClient.ts`
- Create: `browsercli/src/commands/jobs.ts`
- Modify: `browsercli/src/app.ts`
- Modify: `browsercli/src/help.ts`
- Modify: `browsercli/tests/unit/WorkerHttpClient.test.ts`
- Create: `browsercli/tests/unit/jobs.test.ts`
- Modify: `browsercli/tests/unit/help.test.ts`

**Interfaces:**

- Produces: `JobStore.list(): Job[]`
- Adds: `GET /api/v1/jobs` returning `{jobs: Job[]}`
- Adds: `WorkerHttpClient.listJobs(): Promise<{jobs: JobStatus[]}>`
- Adds: `browsercli jobs list [--json]` and `browsercli jobs cancel <job-id> [--json]`

- [ ] **Step 1: Write failing store and route tests**

```ts
const first = store.create('s', 'first', {});
const second = store.create('s', 'second', {});
assert.deepEqual(
  store.list().map(job => job.jobId),
  [first.jobId, second.jobId],
);

await routes.get('GET /api/v1/jobs')!(mockRequest(), res as never);
assert.deepEqual(
  responseData<{jobs: Job[]}>(res).data.jobs.map(job => job.jobId),
  [job.jobId],
);
```

- [ ] **Step 2: Run the focused Worker tests and verify RED**

Run:

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/web/JobStore.test.js build/tests/unit/web/routes/apiV1.test.js
```

Expected: `JobStore.list` and `GET /api/v1/jobs` are missing.

- [ ] **Step 3: Implement the minimal list API**

`JobStore.list()` prunes expired jobs and returns insertion order. The route returns the existing job records in the repository's standard `{success,data}` envelope.

- [ ] **Step 4: Write failing browsercli client, command, and help tests**

```ts
assert.deepEqual(await client.listJobs(), {
  jobs: [{jobId: 'job_1', status: 'running'}],
});
assert.deepEqual(
  await jobsCommand(['cancel', 'job_1', '--json'], ctx),
  expected,
);
assert.match(generateCommandHelp('jobs')!, /jobs cancel <job-id>/);
```

- [ ] **Step 5: Run browsercli tests and verify RED**

Run: `npm --prefix browsercli test`

Expected: missing client method, command, and help entry.

- [ ] **Step 6: Implement and verify the CLI**

Use the existing `tableOutput`/`successOutput` patterns. Reject unknown flags and malformed actions before HTTP. Re-run `npm --prefix browsercli test`; expect all browsercli tests to pass.

---

### Task 2: Make DOM Operations Deadline-Bound and Debugger-Trap Aware

**Files:**

- Modify: `src/tools/shared/browserRuntime.ts`
- Create: `tests/unit/tools/shared/browserRuntime.test.ts`
- Modify: `src/tools/input/fill.ts`
- Modify: `src/tools/input/fillForm.ts`
- Modify: `src/tools/input/click.ts`
- Modify: `src/tools/navigation/navigatePage.ts`
- Modify: `src/tools/screenshot/takeScreenshot.ts`
- Modify: `tests/unit/tools/input/fill.test.ts`
- Create: `tests/unit/tools/input/click.test.ts`
- Modify: `tests/unit/tools/basic-tools.extended.test.ts`

**Interfaces:**

- Produces: `withDebuggerTrapBypass<T>(context, action): Promise<T>`
- `fill`, `fill_form`, and `click` add optional `timeoutMs` (default `10_000`).
- `take_screenshot` adds optional `timeoutMs` (default `15_000`).
- Existing `navigate_page.timeout` remains the navigation deadline.

- [ ] **Step 1: Write the failing CDP trap-guard test**

```ts
const calls: string[] = [];
const context = {
  getExistingDebuggerContext: () => ({
    getPausedState: () => ({reason: 'debugCommand', hitBreakpoints: []}),
    getClient: () => ({
      send: async (method: string, params: unknown) =>
        calls.push(`${method}:${JSON.stringify(params)}`),
    }),
    resume: async () => calls.push('resume'),
  }),
};
await withDebuggerTrapBypass(context, async () => calls.push('action'));
assert.deepEqual(calls, [
  'Debugger.setSkipAllPauses:{"skip":true}',
  'resume',
  'action',
  'Debugger.setSkipAllPauses:{"skip":false}',
]);
```

Add a second test proving a normal breakpoint pause does not call `setSkipAllPauses` or `resume`.

- [ ] **Step 2: Run the shared helper test and verify RED**

Run the compile command from Task 1, then the built `browserRuntime.test.js`. Expected: helper import is missing.

- [ ] **Step 3: Implement the narrow trap guard**

Only act when an already-existing debugger context reports `reason === 'debugCommand'`; never create a debugger context. Set `Debugger.setSkipAllPauses({skip:true})`, resume, execute the operation, and restore `{skip:false}` in `finally`.

- [ ] **Step 4: Write failing interaction timeout/frame tests**

Test that `fill` forwards `timeoutMs`, `click` uses the selected Frame rather than `frame.page()`, and screenshot forwards `timeoutMs` both to Patchright and the outer operation deadline.

- [ ] **Step 5: Implement the smallest tool changes**

Wrap only `fill`, `fill_form`, `click`, `navigate_page`, and `take_screenshot` in the trap guard. Pass timeout values to the underlying Patchright operations so the abandoned promise does not remain unbounded.

- [ ] **Step 6: Run the focused interaction tests and verify GREEN**

Run the built shared/input/basic-tool tests and verify every new assertion passes.

---

### Task 3: Make Existing Evaluate and Cookie Capabilities Discoverable

**Files:**

- Modify: `src/tools/script/script.ts`
- Modify: `src/tools/script/index.ts`
- Modify: `src/tools/debugger/getStorage.ts`
- Modify: `tests/unit/tools/script-eval-callback.test.ts`
- Create: `tests/unit/tools/debugger/getStorage.test.ts`
- Modify: `skills/browsercli/SKILL.md`
- Regenerate: `docs/reference/tool-reference.md`

**Interfaces:**

- `evaluate_script` adds optional `timeoutMs` and preserves the legacy JSON `result` string.
- Successful inline evaluation additionally returns `data.value` as the parsed JSON value.
- `get_storage --type cookies` reads current-page cookies from `BrowserContext.cookies(page.url())`, including HttpOnly cookies, and returns `cookieHeader` in `name=value; name2=value2` form.

- [ ] **Step 1: Write failing evaluate JSON/deadline tests**

```ts
const result = await evaluateScript(runtime, {
  function: '() => ({ok: true})',
  timeoutMs: 20,
});
assert.deepEqual(result.data.value, {ok: true});
assert.equal(capturedRuntimeEvaluateTimeout, 20);
```

- [ ] **Step 2: Write the failing Cookie export test**

Use a page context returning both a normal and HttpOnly cookie, call `get_storage --type cookies`, and assert `cookieHeader === 'sid=rotated; token=abc'` without invoking `frame.evaluate`.

- [ ] **Step 3: Run focused tests and verify RED**

Run the built script and get-storage tests. Expected: missing `data.value`, ignored `timeoutMs`, and missing `cookieHeader`.

- [ ] **Step 4: Implement additive evaluate and Cookie output**

Keep `result` for compatibility. Parse it once with `JSON.parse` into `data.value`; omit `data` for `undefined`. For cookies, use the selected page URL as the browser-context scope and apply the existing case-insensitive key filter before building both the map and header.

- [ ] **Step 5: Correct the Skill and generated reference**

Replace the invalid `get_script_source --prettyPrint/--offset` example with `scriptId`, `filePath`, `startLine`, and `endLine`. Add runnable entries for `evaluate_script`, `get_storage --type cookies`, `collect_wasm --captureBase64 true`, configurable interaction/screenshot timeouts, and `jobs list/cancel`. Export the script ToolDefinitions from `src/tools/script/index.ts`, then run `npm run docs:generate` against a fresh build rather than hand-editing the generated reference.

- [ ] **Step 6: Re-run focused tests and verify GREEN**

Verify the script, storage, metadata/docs, and browsercli tests after the last edit.

---

### Task 4: Final Diff Verification

**Files:** Review only the files changed by this plan plus the existing stuck-worker and WASM plans.

- [ ] **Step 1: Run `git diff --check` and inspect the scoped diff**
- [ ] **Step 2: Run all focused Worker, DOM, evaluate, storage, WASM, and browsercli tests after the last edit**
- [ ] **Step 3: Run `npm run typecheck`, `npm run test:unit`, `npm run check-format`, and `npm --prefix browsercli run typecheck`**
- [ ] **Step 4: Record any pre-existing unrelated failures separately; never claim a failing gate passed**
- [ ] **Step 5: Re-read the user report requirement by requirement and record coverage or a remaining limitation**
