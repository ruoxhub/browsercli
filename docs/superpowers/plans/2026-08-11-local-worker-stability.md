# Local Worker Stability Implementation Plan

> **For agentic workers:** Execute inline in the current `refactor` workspace. Do not dispatch subagents, create commits, or modify unrelated user changes.

**Goal:** Bound local Worker state, reject overlapping HTTP tool jobs, and make `proxycli --watch` follow the existing WebSocket protocol without leaking CLI-only flags.

**Architecture:** Keep `proxycli/` independent and preserve the `/api/v1` boundary. Add small in-memory limits where state already lives, allow one API v1 job at a time with an explicit `WORKER_BUSY` response instead of a pending queue, and reuse the current `WsHub` subscribe protocol instead of introducing a new stream endpoint or dependency.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, native `fetch`/`AbortSignal`, `ws`.

## Global Constraints

- Local, single-user deployment; no cloud-grade WebSocket authentication work in this change.
- Preserve the current BrowserManager and Runtime sharing model.
- Do not merge `proxycli/` into `src/`.
- No new dependency or speculative abstraction.
- Preserve the existing `CLAUDE.md` modification.

---

### Task 1: Bound Worker Job and Session State

**Files:**

- Modify: `src/worker/JobStore.ts`
- Modify: `src/web/routes/apiV1.ts`
- Modify: `tests/unit/web/JobStore.test.ts`
- Create: `tests/unit/web/routes/apiV1.test.ts`

**Interfaces:**

- `new JobStore(options?: {maxJobs?: number; retentionMs?: number; maxLogLines?: number})`
- `createApiV1Routes(deps, options?: {maxSessions?: number})`
- Existing HTTP response shapes and `Job` fields remain unchanged.

- [ ] **Step 1: Write failing JobStore retention tests**

```ts
const store = new JobStore({maxJobs: 2, maxLogLines: 2});
const first = store.create('s', 'first', {});
store.complete(first.jobId, 'done');
const second = store.create('s', 'second', {});
store.create('s', 'third', {});
assert.throws(() => store.get(first.jobId), /JOB_NOT_FOUND/);
assert.equal(store.get(second.jobId).status, 'pending');

store.appendLog(second.jobId, '1');
store.appendLog(second.jobId, '2');
store.appendLog(second.jobId, '3');
assert.deepEqual(store.get(second.jobId).logs, ['2', '3']);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/web/JobStore.test.js
```

Expected: capacity/log assertions fail against the unbounded Map.

- [ ] **Step 3: Implement minimal JobStore bounds**

```ts
export interface JobStoreOptions {
  maxJobs?: number;
  retentionMs?: number;
  maxLogLines?: number;
}

export class JobStore {
  constructor(options: JobStoreOptions = {}) {}
  // Prune expired terminal jobs before reads/creates.
  // At capacity evict the oldest terminal job; reject with JOB_STORE_FULL
  // rather than dropping pending/running jobs.
  // Keep only the newest maxLogLines log entries.
}
```

- [ ] **Step 4: Write failing API route tests**

```ts
const routesA = createApiV1Routes(deps, {maxSessions: 2});
const routesB = createApiV1Routes(deps, {maxSessions: 2});
// A session created in routesA must not appear in routesB.
// Creating three sessions in routesA must retain only the newest two.
// A second invoke while the first is active must return 409 WORKER_BUSY.
// A new invoke must be accepted after the active job settles.
```

- [ ] **Step 5: Run the focused API route test and verify RED**

Run:

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/web/routes/apiV1.test.js
```

Expected: route-instance isolation, session cap, and busy-state assertions fail.

- [ ] **Step 6: Implement route-local bounded sessions and explicit busy state**

```ts
export interface ApiV1Options {
  maxSessions?: number;
}

export function createApiV1Routes(
  deps: ApiV1Deps,
  options: ApiV1Options = {},
): Map<string, RouteHandler> {
  const sessions = new Map<string, SessionRecord>();
  let activeJobId: string | undefined;
  // Evict oldest session before inserting above maxSessions.
  // Return 409 WORKER_BUSY while activeJobId is set so a hung operation cannot
  // accumulate a pending queue. Clear the flag in finally when runJob settles.
  // Keep the existing async 202/job polling contract for accepted jobs.
}
```

- [ ] **Step 7: Run both Worker tests and verify GREEN**

```powershell
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/web/JobStore.test.js build/tests/unit/web/routes/apiV1.test.js
```

---

### Task 2: Repair proxycli Request and Watch Contracts

**Files:**

- Modify: `proxycli/src/WorkerHttpClient.ts`
- Modify: `proxycli/src/commands/shared/tool-args.ts`
- Modify: `proxycli/src/commands/tool-dispatcher.ts`
- Modify: `proxycli/tests/unit/WorkerHttpClient.test.ts`
- Modify: `proxycli/tests/unit/tool-dispatcher.test.ts`

**Interfaces:**

- Keep `WorkerHttpClientOptions.timeoutMs` as the single request/job timeout setting.
- Keep `openStream(sessionId, onEvent): Promise<() => void>` unchanged.
- Subscribe to the existing stream channels: `tool.invoke`, `hook.event`, `hook.sample`, and `log`.

- [ ] **Step 1: Write failing transport tests**

```ts
const client = new WorkerHttpClient({baseUrl, timeoutMs: 20});
await assert.rejects(client.health()); // server responds after 100ms

const close = await client.openStream('sess_x', () => {});
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(receivedMessages, [
  {type: 'subscribe', channel: 'tool.invoke'},
  {type: 'subscribe', channel: 'hook.event'},
  {type: 'subscribe', channel: 'hook.sample'},
  {type: 'subscribe', channel: 'log'},
]);
close();
```

- [ ] **Step 2: Run proxycli tests and verify RED**

Run: `npm test` from `proxycli/`.

Expected: delayed HTTP response resolves instead of aborting, and WebSocket receives no subscriptions.

- [ ] **Step 3: Add native request abort and stream subscriptions**

```ts
const signal = init?.signal ?? AbortSignal.timeout(this.timeoutMs);
const res = await fetch(url, {...init, signal, headers});

ws.on('open', () => {
  for (const channel of STREAM_CHANNELS) {
    ws.send(JSON.stringify({type: 'subscribe', channel}));
  }
  resolve();
});
```

- [ ] **Step 4: Write failing dispatcher tests**

```ts
await toolDispatcherCommand(
  ['my_tool', '--session', 'sess_abc', '--watch', '--foo', 'bar'],
  ctx,
);
assert.deepEqual(client.invokeCalls[0][2], {foo: 'bar'});
assert.deepEqual(client.callOrder, ['ensureSession', 'openStream', 'invoke']);
```

- [ ] **Step 5: Run proxycli tests and verify RED**

Run: `npm test` from `proxycli/`.

Expected: `session`/`watch` appear in tool params and invoke happens before stream setup.

- [ ] **Step 6: Filter control flags and open watch before invoke**

```ts
const CONTROL_FLAGS = new Set(['file', 'data', 'stdin', 'session', 'watch']);
if (CONTROL_FLAGS.has(key)) continue;

const requestedSessionId = getFlag(parsed, 'session');
const watch = getBoolFlag(parsed, 'watch');
const sessionId = watch
  ? await httpClient.ensureSession(requestedSessionId)
  : requestedSessionId;
// Non-fatal openStream before invoke; close it if invoke fails.
```

- [ ] **Step 7: Run proxycli tests and verify GREEN**

Run: `npm test` from `proxycli/`.

---

### Task 3: Final Diff Verification

**Files:** Review every file changed by Tasks 1–2; do not edit generated `build/` output.

- [ ] **Step 1: Inspect scoped diff and format only changed source/test files**

Run `git diff --check` and Prettier on the changed files if required.

- [ ] **Step 2: Run focused regression tests after the last edit**

Run the Worker focused tests and `proxycli/npm test`.

- [ ] **Step 3: Run repository gates after the final edit**

```powershell
npm run typecheck
npm run test:unit
npm run check-format
```

From `proxycli/`:

```powershell
npm run typecheck
npm test
```

- [ ] **Step 4: Reinspect final diff and report evidence**

Report changed files, red-to-green evidence, final command results, any unrelated pre-existing failures, and unverified real-browser boundaries. Do not commit or push without an explicit request.
