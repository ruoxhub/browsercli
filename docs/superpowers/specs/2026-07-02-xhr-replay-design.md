# XHR Replay Toolset — Design Spec

**Date:** 2026-07-02
**Domain:** `src/tools/network/`
**Status:** Approved (brainstorming complete, ready for implementation plan)

## Goal

Add three MCP tools to `src/tools/network/` that replay, export, and batch-replay
captured network requests. The toolset serves four workflows in a reverse-engineering
context:

1. **改参重放验签** — replay a captured request with field overrides to verify which
   fields affect signature validity and parameter legality.
2. **原样重放观察** — replay unchanged to check response consistency, token expiry,
   cache behavior.
3. **导出 curl / 独立脚本** — export a captured request as a curl command for
   reproduction outside the browser.
4. **批量 / 模糊测试** — replay one request against many override variants to observe
   response distribution and assist signature cracking.

All four are unified under a single override model and a shared pure-function engine.

## Non-Goals

- In-page replay mode (page-internal `fetch`/`XHR` via `page.evaluate`).
- CDP `Fetch` / `Network` domain manipulation of live requests.
- Signature re-computation (the page's job; we are explicitly page-off).
- Retry, backoff, inter-request delay.
- Cookie path/secure/samesite scope filtering (suffix-match only).
- A `ReplayManager` class or `RuntimeServices` getter (deferred until tool-external
  consumers exist — Approach B from brainstorming).
- Integration tests in v1 (unit coverage is sufficient; matches `getNetworkRequest`
  precedent of mocking the context provider).

## Key Decisions

| Decision                  | Choice                                                         | Rationale                                                                                                                                |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Execution context         | Page-off via `page.context().request` (`APIRequestContext`)    | Reuses browser cookies/storage/UA; bypasses CORS and page JS interceptors; the headers you specify are the headers sent (no re-signing). |
| Field override semantics  | Merge by default; `replaceHeaders: true` for wholesale replace | Preserves signature headers while allowing targeted mutation — central to the verify-signature workflow.                                 |
| Tool surface              | Three independent tools                                        | Clean separation of concerns; isolated testing; predictable schemas.                                                                     |
| Architecture              | `replayEngine.ts` pure module + three thin tool files          | Matches `src/tools/network/` convention; testable without browser; no `@stable` high-fan-in interface touched.                           |
| `readOnlyHint`            | `false` for replay tools, `true` for export                    | Replay makes real network requests; export only reads and formats.                                                                       |
| Cookie embedding (export) | Off by default, opt-in via `includeCookies`                    | Cookies may be sensitive; matches "提交前确认敏感凭证已脱敏" rule in AGENTS.md.                                                          |

## Architecture & File Layout

All new code in `src/tools/network/`. No new managers, no `RuntimeServices` getter,
no `@stable` interface changes.

```
src/tools/network/
├── replayEngine.ts                ← NEW: pure functions
├── replayNetworkRequest.ts        ← NEW: tool 1 (single replay)
├── exportRequestAsCurl.ts         ← NEW: tool 2 (curl export)
├── replayNetworkRequestBatch.ts   ← NEW: tool 3 (batch/fuzz)
├── types.ts                       ← EDIT: append replay types
├── manifest.ts                    ← EDIT: register 3 new tools
└── index.ts                       ← EDIT: re-export new tools + types
```

**Dependency direction:** the three tool files import from `replayEngine.ts`. The
engine imports only from `../../third_party/index.js` (Playwright types) and
`./types.js`. No cross-tool imports except batch → engine (not batch → single).

**Registration:** three entries appended to `manifest.ts` `tools[]`. Profile stays
`'workflow'`. All tools follow `defineTool` factory exactly like neighbors.

**Test mirror** (per AGENTS.md):

```
tests/unit/tools/network/
├── replayEngine.test.ts
├── replayNetworkRequest.test.ts
├── exportRequestAsCurl.test.ts
└── replayNetworkRequestBatch.test.ts
```

Engine unit tests run without a browser. Tool tests mock `replayEngine` to verify
wiring + structured-response shape, consistent with how `getNetworkRequest.test.ts`
mocks the context provider.

## `replayEngine.ts` — Pure Functions

Five exported functions, no class, no state. Each independently testable.

### Types (added to `types.ts`, all new — no edits to existing types)

```typescript
/** Fields a caller may override on a captured request. All optional. */
export interface ReplayOverride {
  method?: string;
  url?: string;
  headers?: Record<string, string>; // merged (see below)
  body?: string; // whole-body replacement; null clears body
  replaceHeaders?: boolean; // default false → merge; true → headers replaces wholesale
}

/** What gets sent to APIRequestContext. */
export interface BuiltReplayRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Normalized response from a replay attempt. */
export interface ReplayResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string; // truncated to maxBodyLength
  bodyTruncated: boolean;
  timingMs: number;
  replayedUrl: string; // final URL after any overrides
}

/** Per-variant result in batch. */
export interface BatchVariantResult {
  index: number;
  override: ReplayOverride;
  result: ReplayResponse;
  error?: string; // set when result is the empty-shape fallback
}

/** Batch aggregate. */
export interface BatchReplayResult {
  total: number;
  succeeded: number;
  failed: number;
  statusCodeDistribution: Record<number, number>;
  results: BatchVariantResult[];
}
```

### `STRIPPED_HEADERS` constant

Exported array at module top, for tests:

```typescript
export const STRIPPED_HEADERS = [
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
];
```

These are hop-by-hop / transport-managed headers that `APIRequestContext` owns.
Stripped case-insensitively. All signature-bearing headers (`sign`, `signature`,
`x-sign`, `token`, `auth`, `nonce`, `timestamp`, …) are preserved by default.

### `stripManagedHeaders(headers: Record<string, string>): Record<string, string>`

Removes the `STRIPPED_HEADERS` set, case-insensitively. Pure and deterministic.

### `buildReplayRequest(original: GetNetworkRequestData, override?: ReplayOverride): BuiltReplayRequest`

- `method`: `override.method?.toUpperCase() ?? original.method`
- `url`: `override.url ?? original.url`
- `headers`:
  - if `override.replaceHeaders === true` → `override.headers ?? {}`
  - else → merge `original.requestHeaders` with `override.headers`. Key collision
    is resolved case-insensitively: if original has `Content-Type` and override
    has `content-type`, the override value wins and the original key is removed
    (result has exactly one entry for that header name, using the override's
    casing).
  - always run through `stripManagedHeaders` at the end
- `body`: `override.body !== undefined ? (override.body ?? undefined) : original.postData`
  - explicit `null` clears body; omitting keeps original

`GetNetworkRequestData` already carries `url`, `method`, `postData`,
`requestHeaders` — no new fetch needed to source the original. Caller obtains it
once via `context.getNetworkRequestById(reqid)` + `response()`.

### `executeReplay(page: Page, built: BuiltReplayRequest, maxBodyLength: number): Promise<ReplayResponse>`

- `const started = Date.now();`
- `const apiCtx = page.context().request;` (Playwright `APIRequestContext`,
  reuses cookies/storage/UA from the live browser context — no new context spun up)
- `const resp = await apiCtx.fetch(built.url, { method, headers, data: built.body });`
- Reads `resp.status()`, `resp.statusText?.()` (guarded), `resp.headers()`,
  `await resp.text()` (guarded, truncated to `maxBodyLength`).
- `timingMs = Date.now() - started`.
- Network/HTTP errors throw and propagate as exceptions with the original error
  message so the tool layer can attach them to `BatchVariantResult.error` or the
  single-replay error path.
- Body read failures fall back to `body: ''`, `bodyTruncated: false`.

### `formatCurl(built: BuiltReplayRequest, opts: { includeCookies?: boolean; cookies?: {name: string; value: string}[] }): string`

- Emits one-line sh-style curl: `curl -X METHOD 'URL' -H 'K: V' ... --data 'BODY'`
- Single-quoted, escapes `'` as `'\''`.
- Method omitted from `-X` when GET (curl default).
- `--data` only when `built.body` is non-empty.
- When `includeCookies === true` and `cookies` provided, appends
  `-H 'Cookie: name=value; ...'`. Caller fetches cookies via
  `page.context().cookies()` — engine stays pure.
- No `--compressed`, no `--insecure`, no `--silent` — minimal output.

### `emptyReplayResponse(url: string): ReplayResponse`

Returns the zero-field shell `{ status: 0, statusText: '', headers: {}, body: '',
bodyTruncated: false, timingMs: 0, replayedUrl: url }`. Exported for tests and
used by the batch tool for failed variants.

## Tool 1: `replay_network_request`

Single-request replay with optional overrides. The primary
"改参重放验签" tool.

### Definition

```typescript
export const replayNetworkRequest = defineTool({
  name: 'replay_network_request',
  description: 'Replay a captured network request (by reqid) using the browser context\'s cookies and storage. Supports overriding method, url, headers, and body. Useful for verifying signature field effects and parameter validity.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,   // makes a real network request
  },
  schema: { ... },
  handler: async (request, response, context) => { ... },
});
```

`readOnlyHint: false` — first network tool with this hint in this domain. Flagged
for review awareness.

### Schema

```typescript
{
  reqid: zod.number().int().positive().describe(
    'The reqid of the captured network request to replay. Use list_network_requests to find it.'
  ),
  method: zod.string().optional().describe(
    'Override the HTTP method (e.g. POST, GET). Defaults to the original method.'
  ),
  url: zod.string().optional().describe(
    'Override the request URL. Defaults to the original URL.'
  ),
  headers: zod.record(zod.string(), zod.string()).optional().describe(
    'Headers to merge with the original (override wins on key collision, case-insensitive). Set replaceHeaders=true to replace wholesale.'
  ),
  body: zod.string().nullable().optional().describe(
    'Override the request body. null clears the body. Omit to keep the original. Only meaningful for POST/PUT/PATCH.'
  ),
  replaceHeaders: zod.boolean().optional().describe(
    'If true, the headers param replaces the original headers entirely. Default false (merge).'
  ),
  maxBodyLength: zod.number().int().positive().optional().describe(
    'Maximum length of the response body to return. Defaults to 2000 characters.'
  ),
}
```

### Handler flow

1. `const page = context.getSelectedPage();` — same as `clickAt`, `fill`, etc.
   Let it throw if no page; `ToolExecutionPipeline` already surfaces that.
2. Fetch original request via `context.getNetworkRequestById(reqid)` and its
   `response()` for headers. Build a `GetNetworkRequestData`-shaped object.
   - Guard: if `getNetworkRequestById` throws (bad reqid, navigated away), return
     `success:false` with the error message and an empty `ReplayResponse` shell —
     same pattern as `getNetworkRequest`'s catch block.
3. `const built = buildReplayRequest(originalData, override);`
4. `const result = await executeReplay(page, built, maxBodyLength ?? 2000);` —
   wrapped in try/catch.
5. On success: `response.setStructuredContent({ success: true, message:
'请求重放成功：HTTP ${status}', tooltype: 'replay_network_request', data:
{ ...result, originalReqid: reqid, override: override ?? null } })`.
6. On `executeReplay` failure: `success: false`, message includes status code if
   response was received (use `result.status` when available) or the error
   string, `data` is the empty `ReplayResponse` shell plus `originalReqid` and
   `error`.

### Response `data` shape

```typescript
{
  originalReqid: number;
  override: ReplayOverride | null; // what was applied, for traceability
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  timingMs: number;
  replayedUrl: string;
}
```

Including `override` in the response lets the user confirm what was actually sent
when iterating on signature tests — matches the "Evidence-first" methodology in
AGENTS.md.

### What this tool does NOT do

- No `mode` switch — single page-off path.
- No cookie fetching (engine handles via `page.context().request`).
- No automatic retry on 5xx — one shot, surface the result.
- No `includeCookies` option — the live context already has them.

## Tool 2: `export_request_as_curl`

Produces a copy-pasteable curl command from a captured request. Supports the same
override model so the exported command reflects intended modifications.

### Definition

```typescript
export const exportRequestAsCurl = defineTool({
  name: 'export_request_as_curl',
  description:
    'Export a captured network request (by reqid) as a curl command. Supports the same overrides as replay_network_request. Useful for reproducing a request outside the browser or verifying that an exported command reproduces the captured response.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true, // builds a string, sends nothing
  },
});
```

`readOnlyHint: true` — only reads the captured request and formats a string.
Matches `get_network_request`.

### Schema

```typescript
{
  reqid: zod.number().int().positive().describe(
    'The reqid of the captured network request to export.'
  ),
  method: zod.string().optional(),
  url: zod.string().optional(),
  headers: zod.record(zod.string(), zod.string()).optional(),
  body: zod.string().nullable().optional(),
  replaceHeaders: zod.boolean().optional(),
  includeCookies: zod.boolean().optional().describe(
    'If true, embed cookies from the browser context as a Cookie header in the curl command. Default false (cookies are session-bound and may be sensitive).'
  ),
}
```

No `maxBodyLength` — export produces a command string, no response body to
truncate.

### Handler flow

1. `const page = context.getSelectedPage();`
2. Fetch original via `context.getNetworkRequestById(reqid)` + `response()` for
   headers — same sourcing as Tool 1.
3. Bad reqid → `success: false`, message, `data: { curl: '', originalReqid: reqid }`.
4. `const built = buildReplayRequest(originalData, override);`
5. If `includeCookies === true`: `const cookies = await page.context().cookies();`
   then filter to cookies whose `domain` matches the built URL's host. Match
   rule: strip leading dot from cookie `domain`, then accept if the URL host
   equals the domain OR ends with `.` + domain (e.g. cookie domain `example.com`
   matches `api.example.com` and `example.com` but not `evil-example.com`).
   Path/secure/samesite filtering skipped for simplicity, documented in the
   response message. Pass to `formatCurl`.
   - Cookie read failure → proceed without cookies, append a note to the message:
     `"（Cookie 读取失败，已省略）"`.
6. `const curl = formatCurl(built, { includeCookies, cookies });`
7. `response.setStructuredContent({ success: true, message: '已导出 curl 命令',
tooltype: 'export_request_as_curl', data: { curl, originalReqid: reqid,
override: override ?? null } })`.

### Response `data` shape

```typescript
{
  curl: string; // the full one-line command
  originalReqid: number;
  override: ReplayOverride | null;
}
```

### Design notes

- **Cookie embedding off by default** — cookies may be sensitive. User opts in
  per call. Matches "提交前确认敏感凭证已脱敏" rule in AGENTS.md.
- **No response preview** — export is about the request, not the response.
- **Domain filtering for cookies** is deliberately simple (host equals domain
  OR ends with `.` + domain). Exact cookie scoping rules (path, secure,
  samesite) are out of scope. The response message notes when filtering dropped
  cookies.

## Tool 3: `replay_network_request_batch`

Batch/fuzz replay. Same override model per variant, sequential or
bounded-concurrent execution, aggregate report. The "批量/模糊测试" tool.

### Definition

```typescript
export const replay_network_request_batch = defineTool({
  name: 'replay_network_request_batch',
  description:
    'Replay a captured network request multiple times with different overrides (variants). Useful for fuzzing signature fields, testing parameter boundaries, and observing response distribution. Sequential by default; bounded concurrency available.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
});
```

### Schema

```typescript
{
  reqid: zod.number().int().positive().describe(
    'The reqid of the captured request to use as the template.'
  ),
  variants: zod.array(
    zod.object({
      method: zod.string().optional(),
      url: zod.string().optional(),
      headers: zod.record(zod.string(), zod.string()).optional(),
      body: zod.string().nullable().optional(),
      replaceHeaders: zod.boolean().optional(),
    })
  ).min(1).max(50).describe(
    'Override variants to apply. Each variant produces one replay. Max 50 to bound runtime.'
  ),
  concurrency: zod.number().int().min(1).max(10).optional().describe(
    'Max parallel replays. Default 1 (sequential). Higher values risk server-side rate limiting.'
  ),
  maxBodyLength: zod.number().int().positive().optional().describe(
    'Maximum length of each response body to return. Defaults to 500 (smaller than single-replay default since results aggregate).'
  ),
}
```

### Constants

```typescript
const DEFAULT_BATCH_MAX_BODY_LENGTH = 500;
const MAX_VARIANTS = 50; // mirrored in schema .max(50)
const MAX_CONCURRENCY = 10; // mirrored in schema .max(10)
```

### Handler flow

1. `const page = context.getSelectedPage();`
2. Fetch original once via `context.getNetworkRequestById(reqid)` + `response()`.
   Bad reqid → `success: false`, `data: { total: variants.length, succeeded: 0,
failed: variants.length, statusCodeDistribution: {}, results: [] }`.
3. Build all `BuiltReplayRequest`s up front via
   `variants.map(v => buildReplayRequest(originalData, v))`. Validation errors
   per variant caught here and recorded as a failed `BatchVariantResult` with
   `error` set, empty `ReplayResponse` shell — does not abort the batch.
4. Execute with bounded concurrency:

   ```typescript
   const results: BatchVariantResult[] = [];
   const queue = built.map((b, i) => ({b, i}));
   const workers = Array.from(
     {length: Math.min(concurrency, variants.length)},
     async () => {
       while (queue.length) {
         const next = queue.shift();
         if (!next) break;
         try {
           const r = await executeReplay(page, next.b, maxBodyLength);
           results[next.i] = {
             index: next.i,
             override: variants[next.i],
             result: r,
           };
         } catch (e) {
           results[next.i] = {
             index: next.i,
             override: variants[next.i],
             result: emptyReplayResponse(next.b.url),
             error: e instanceof Error ? e.message : String(e),
           };
         }
       }
     },
   );
   await Promise.all(workers);
   ```

5. Aggregate: `statusCodeDistribution` counts `result.status` across all variants
   (including `0` for failures). `succeeded` = variants without `error`. `failed`
   = variants with `error`.
6. `response.setStructuredContent({ success: failed === 0, message:
'批量重放完成：${succeeded}/${total} 成功', tooltype:
'replay_network_request_batch', data: { total, succeeded, failed,
statusCodeDistribution, results } })`.
   - `success: true` only when all variants succeeded. Partial failure still
     returns aggregated data.

### Response `data` shape

```typescript
{
  total: number;
  succeeded: number;
  failed: number;
  statusCodeDistribution: Record<number, number>;
  results: BatchVariantResult[];
}
```

### Design notes

- **`MAX_VARIANTS = 50`** bounds runtime and response size. At 50 variants ×
  500-char bodies, response is ~25KB worst case — well under MCP limits.
- **Concurrency default 1** — server-side rate limiting and signature anti-replay
  are real concerns in the reverse-engineering context. User opts into higher
  concurrency explicitly.
- **No inter-request delay** — out of scope; user runs single-replay in a loop if
  needed.
- **No early abort on error** — fuzzing is about observing the distribution,
  including failures.
- **Per-variant `buildReplayRequest` errors** are caught, not thrown — one bad
  override shouldn't kill the batch.
- **`success` semantics**: "all variants executed without exception" counts as
  success, even if some returned HTTP 4xx/5xx. An HTTP 500 is a successful replay
  that got a 500 — that's signal, not failure. Only `executeReplay` throwing
  (network error, context gone) marks a variant as failed.

## Registration & Exports

### `manifest.ts` edit

Append three entries to `tools[]`:

```typescript
{modulePath: './network/replayNetworkRequest.js', handlerName: 'replayNetworkRequest'},
{modulePath: './network/exportRequestAsCurl.js', handlerName: 'exportRequestAsCurl'},
{modulePath: './network/replayNetworkRequestBatch.js', handlerName: 'replayNetworkRequestBatch'},
```

Profile stays `'workflow'`. No new domain.

### `index.ts` edits

Add to the Network 工具 section:

```typescript
export {replayNetworkRequest} from './replayNetworkRequest.js';
export {exportRequestAsCurl} from './exportRequestAsCurl.js';
export {replayNetworkRequestBatch} from './replayNetworkRequestBatch.js';
```

Add to the type re-exports block:

```typescript
ReplayOverride,
BuiltReplayRequest,
ReplayResponse,
BatchVariantResult,
BatchReplayResult,
ReplayNetworkRequestParams,
ReplayNetworkRequestData,
ExportRequestAsCurlParams,
ExportRequestAsCurlData,
ReplayNetworkRequestBatchParams,
ReplayNetworkRequestBatchData,
ReplayNetworkRequestResult,
ExportRequestAsCurlResult,
ReplayNetworkRequestBatchResult,
```

## Testing Strategy

### `tests/unit/tools/network/replayEngine.test.ts` — pure-function, no browser

- `stripManagedHeaders`: removes the 7 managed headers case-insensitively;
  preserves signature headers (`x-sign`, `signature`, `token`, `nonce`,
  `timestamp`, `auth`); leaves arbitrary custom headers untouched.
- `buildReplayRequest`:
  - no override → mirrors original (method uppercased, headers stripped).
  - `headers` override merges (case-insensitive collision → override wins).
  - `replaceHeaders: true` → override replaces wholesale.
  - `body: undefined` keeps original; `body: null` clears; `body: 'x'` replaces.
  - `method` uppercased.
- `formatCurl`:
  - GET omits `-X`.
  - POST includes `-X POST` and `--data` when body present.
  - Single-quote escaping of `'` in URL, header values, body.
  - `includeCookies: true` with cookies → `-H 'Cookie: ...'` appended; without
    cookies → no Cookie header.
  - Empty body → no `--data`.
- `emptyReplayResponse`: returns zero-shell with `replayedUrl` set from arg.

### `tests/unit/tools/network/replayNetworkRequest.test.ts` — mock engine

- Happy path: returns `success: true`, `data.status` matches mock, `data.override`
  echoed.
- Bad reqid: `getNetworkRequestById` throws → `success: false`, empty shell,
  error message.
- `executeReplay` throws → `success: false`, error message surfaced.
- Override merge: verify `buildReplayRequest` called with correct args.
- `maxBodyLength` default applied (2000) when omitted.

### `tests/unit/tools/network/exportRequestAsCurl.test.ts` — mock engine

- Happy path without cookies: `data.curl` matches mock return; `includeCookies`
  not passed to `formatCurl`.
- `includeCookies: true`: cookies fetched, passed to `formatCurl`.
- Cookie read failure: proceeds without cookies, message notes failure.
- Bad reqid: `success: false`, empty curl.

### `tests/unit/tools/network/replayNetworkRequestBatch.test.ts` — mock engine

- 3 variants, concurrency 1: executes all, aggregates correctly.
- 1 variant throws: marked `failed`, others `succeeded`, `success: false` overall.
- `buildReplayRequest` throws for one variant: that variant recorded with `error`,
  others proceed.
- `statusCodeDistribution` correct (e.g. two 200s + one 500 → `{200: 2, 500: 1}`).
- Concurrency 3 with 5 variants: all execute, results indexed correctly (no gaps,
  no duplicates).
- `maxBodyLength` default applied (500) when omitted.

No integration tests in v1 — the engine is pure and tool tests mock the browser
boundary. An integration test could be added later, but YAGNI for v1; the unit
coverage is sufficient and matches the `getNetworkRequest.test.ts` precedent.

## Error Handling Summary

| Failure                         | Single                                                                                      | Export                                          | Batch                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| No selected page                | `context.getSelectedPage()` throws → `ToolExecutionPipeline` surfaces (no special handling) | same                                            | same                                                 |
| Bad reqid                       | `success: false`, empty shell, error message                                                | `success: false`, empty curl                    | `success: false`, aggregate with all variants failed |
| `buildReplayRequest` throws     | caught in try/catch → `success: false`                                                      | same                                            | per-variant `error`, batch continues                 |
| `executeReplay` throws          | `success: false`, error message                                                             | N/A (no execute)                                | per-variant `error`, batch continues                 |
| Cookie read fails (export only) | N/A                                                                                         | proceeds without cookies, message notes failure | N/A                                                  |
| Body read fails                 | `executeReplay` returns `body: ''`, `bodyTruncated: false`                                  | N/A                                             | same as single                                       |
