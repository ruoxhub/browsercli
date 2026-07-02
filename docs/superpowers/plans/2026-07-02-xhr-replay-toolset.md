# XHR Replay Toolset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three MCP tools (`replay_network_request`, `export_request_as_curl`, `replay_network_request_batch`) to `src/tools/network/` that replay, export, and batch-replay captured network requests, backed by a shared pure `replayEngine.ts` module.

**Architecture:** Page-off execution via Playwright `APIRequestContext` (reuses browser cookies/storage/UA, bypasses CORS and page JS interceptors). Merge-override semantics preserve signature headers while allowing targeted mutation. Three thin tool files import from one pure engine module — no managers, no `RuntimeServices` getter, no `@stable` interface changes.

**Tech Stack:** TypeScript ESM, Node 20.19+, `node:test` + `node:assert`, `patchright` (Playwright fork) for `APIRequestContext`/`APIResponse`, `zod` for schemas, existing `defineTool` factory.

**Spec:** `docs/superpowers/specs/2026-07-02-xhr-replay-design.md`

## Global Constraints

- TypeScript ESM, Prettier: `singleQuote: true`, `trailingComma: all`, `arrowParens: avoid`, `endOfLine: lf`.
- ESLint flat config: imports alphabetical, type imports explicit, `interface` over `type`, `node:` prefix for builtins.
- File naming and structure mirror existing `src/tools/network/` files.
- Tests use `node:test` (`describe`/`it`) and `node:assert`; test files mirror source path under `tests/unit/`.
- Commits use Conventional Commits (`feat:`, `test:`, `refactor:`, etc.).
- No real cookies, storage, production params, or `artifacts/tasks/` content in commits.
- Type imports via `import type`; third-party types centralized through `src/third_party/`.
- Do not modify `@stable` high-fan-in symbols (`defineTool`, `Runtime`, `getRuntime`, `NetworkRuntimeServices`) — extend with optional properties only.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/third_party/playwright.ts` | Modify | Re-export `APIRequestContext`, `APIResponse` types from `patchright`. |
| `src/tools/network/types.ts` | Modify | Append replay types (`ReplayOverride`, `BuiltReplayRequest`, `ReplayResponse`, `BatchVariantResult`, `BatchReplayResult`, param/result types). |
| `src/tools/network/replayEngine.ts` | Create | Pure functions: `STRIPPED_HEADERS`, `stripManagedHeaders`, `buildReplayRequest`, `executeReplay`, `emptyReplayResponse`, `formatCurl`. |
| `src/tools/network/replayNetworkRequest.ts` | Create | Tool 1: single-request replay with overrides. |
| `src/tools/network/exportRequestAsCurl.ts` | Create | Tool 2: curl command export. |
| `src/tools/network/replayNetworkRequestBatch.ts` | Create | Tool 3: batch/fuzz replay with bounded concurrency. |
| `src/tools/network/manifest.ts` | Modify | Register three new tools. |
| `src/tools/network/index.ts` | Modify | Re-export new tools and types. |
| `tests/unit/tools/network/replayEngine.test.ts` | Create | Pure-function unit tests for engine. |
| `tests/unit/tools/network/replayNetworkRequest.test.ts` | Create | Tool 1 tests (mock engine + context). |
| `tests/unit/tools/network/exportRequestAsCurl.test.ts` | Create | Tool 2 tests (mock engine + context). |
| `tests/unit/tools/network/replayNetworkRequestBatch.test.ts` | Create | Tool 3 tests (mock engine + context). |

**Dependency direction:** tool files → `replayEngine.ts` → `types.ts` + `third_party`. No cross-tool imports (batch does not import single).

**Spec refinement:** `executeReplay(apiCtx: APIRequestContext, ...)` instead of `executeReplay(page: Page, ...)` — keeps the engine pure and testable (matches the spec's test plan: "mock `APIRequestContext`"). Each tool extracts `page.context().request` and passes it in.

---

### Task 1: Add replay types and re-export Playwright API types

**Files:**
- Modify: `src/third_party/playwright.ts` (add `APIRequestContext`, `APIResponse` to the existing `export type {...} from 'patchright'` block)
- Modify: `src/tools/network/types.ts` (append new types after the existing `ClearNetworkRequestsResult` at end of file)
- Test: `tests/unit/tools/network/replayEngine.test.ts` (type-level only — no runtime test in this task)

**Interfaces:**
- Produces: `ReplayOverride`, `BuiltReplayRequest`, `ReplayResponse`, `BatchVariantResult`, `BatchReplayResult`, and the param/result types consumed by Tasks 3-5. Also produces `APIRequestContext`/`APIResponse` re-exports from `src/third_party/index.js`.

- [ ] **Step 1: Add Playwright API type re-exports**

Edit `src/third_party/playwright.ts` — add `APIRequestContext` and `APIResponse` to the existing `export type {...} from 'patchright'` block (lines 11-33). Insert alphabetically — `APIRequestContext` and `APIResponse` go before `Browser`:

```typescript
export type {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  // ... rest unchanged
} from 'patchright';
```

- [ ] **Step 2: Append replay types to `src/tools/network/types.ts`**

Add at the end of the file, after the existing `ClearNetworkRequestsResult` type:

```typescript
// ─── Replay 类型 ──────────────────────────────────────────

/** Replay 时可覆盖的字段。全部可选。 */
export interface ReplayOverride {
  /** 覆盖 HTTP 方法（大写化） */
  method?: string;
  /** 覆盖请求 URL */
  url?: string;
  /** 与原始 headers 合并（覆盖同名键，大小写不敏感）；replaceHeaders=true 时整体替换 */
  headers?: Record<string, string>;
  /** 整体替换请求体；null 清空 body；省略保留原始 */
  body?: string | null;
  /** 默认 false=合并；true=headers 参数整体替换原始 headers */
  replaceHeaders?: boolean;
}

/** 发送给 APIRequestContext 的构建结果。 */
export interface BuiltReplayRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** 单次 replay 的归一化响应。 */
export interface ReplayResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  timingMs: number;
  replayedUrl: string;
}

/** 批量 replay 中单个 variant 的结果。 */
export interface BatchVariantResult {
  index: number;
  override: ReplayOverride;
  result: ReplayResponse;
  /** executeReplay 抛出时设置；HTTP 4xx/5xx 不视为 error */
  error?: string;
}

/** 批量 replay 聚合结果。 */
export interface BatchReplayResult {
  total: number;
  succeeded: number;
  failed: number;
  statusCodeDistribution: Record<number, number>;
  results: BatchVariantResult[];
}

// ─── Replay 参数与结果类型 ──────────────────────────────────

/** replay_network_request 参数 */
export interface ReplayNetworkRequestParams {
  reqid: number;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
  replaceHeaders?: boolean;
  maxBodyLength?: number;
}

/** replay_network_request 返回数据 */
export interface ReplayNetworkRequestData extends ReplayResponse {
  originalReqid: number;
  override: ReplayOverride | null;
}

/** export_request_as_curl 参数 */
export interface ExportRequestAsCurlParams {
  reqid: number;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | null;
  replaceHeaders?: boolean;
  includeCookies?: boolean;
}

/** export_request_as_curl 返回数据 */
export interface ExportRequestAsCurlData {
  curl: string;
  originalReqid: number;
  override: ReplayOverride | null;
}

/** replay_network_request_batch 参数 */
export interface ReplayNetworkRequestBatchParams {
  reqid: number;
  variants: ReplayOverride[];
  concurrency?: number;
  maxBodyLength?: number;
}

/** replay_network_request_batch 返回数据 */
export interface ReplayNetworkRequestBatchData extends BatchReplayResult {}

// ─── Replay 结果类型 ──────────────────────────────────────

/** replay_network_request 结果 */
export type ReplayNetworkRequestResult =
  NetworkResult<ReplayNetworkRequestData>;

/** export_request_as_curl 结果 */
export type ExportRequestAsCurlResult =
  NetworkResult<ExportRequestAsCurlData>;

/** replay_network_request_batch 结果 */
export type ReplayNetworkRequestBatchResult =
  NetworkResult<ReplayNetworkRequestBatchData>;
```

- [ ] **Step 3: Run typecheck to verify types compile**

Run: `npm run typecheck`
Expected: PASS with no errors. If errors, fix import paths or type names.

- [ ] **Step 4: Commit**

```bash
git add src/third_party/playwright.ts src/tools/network/types.ts
git commit -m "feat(network): add replay types and re-export Playwright API types"
```

---

### Task 2: Implement `replayEngine.ts` (TDD)

**Files:**
- Create: `src/tools/network/replayEngine.ts`
- Test: `tests/unit/tools/network/replayEngine.test.ts`

**Interfaces:**
- Consumes: `ReplayOverride`, `BuiltReplayRequest`, `ReplayResponse`, `GetNetworkRequestData` from `./types.js`; `APIRequestContext`, `APIResponse` from `../../third_party/index.js`.
- Produces: `STRIPPED_HEADERS` (const), `stripManagedHeaders`, `buildReplayRequest`, `executeReplay`, `emptyReplayResponse`, `formatCurl` — all consumed by Tasks 3-5.

- [ ] **Step 1: Write failing tests for `stripManagedHeaders` and `STRIPPED_HEADERS`**

Create `tests/unit/tools/network/replayEngine.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  STRIPPED_HEADERS,
  stripManagedHeaders,
} from '../../../../src/tools/network/replayEngine.js';

describe('STRIPPED_HEADERS', () => {
  it('contains the 7 hop-by-hop / transport-managed headers', () => {
    assert.deepStrictEqual([...STRIPPED_HEADERS].sort(), [
      'accept-encoding',
      'connection',
      'content-encoding',
      'content-length',
      'host',
      'keep-alive',
      'transfer-encoding',
    ]);
  });
});

describe('stripManagedHeaders', () => {
  it('removes managed headers case-insensitively', () => {
    const input = {
      Host: 'example.com',
      'Content-Length': '42',
      CONNECTION: 'keep-alive',
      'Accept-Encoding': 'gzip',
      'Content-Encoding': 'br',
      'Transfer-Encoding': 'chunked',
      'Keep-Alive': 'timeout=5',
      'X-Custom': 'keep-me',
    };
    assert.deepStrictEqual(stripManagedHeaders(input), {
      'X-Custom': 'keep-me',
    });
  });

  it('preserves signature-bearing headers', () => {
    const input = {
      'X-Sign': 'abc123',
      Signature: 'def456',
      token: 'tok',
      auth: 'bearer xyz',
      nonce: 'n1',
      timestamp: '1700000000',
    };
    assert.deepStrictEqual(stripManagedHeaders(input), input);
  });

  it('returns empty object for empty input', () => {
    assert.deepStrictEqual(stripManagedHeaders({}), {});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: FAIL — `Cannot find module '...replayEngine.js'`

- [ ] **Step 3: Create `src/tools/network/replayEngine.ts` with `STRIPPED_HEADERS` and `stripManagedHeaders`**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  APIRequestContext,
  APIResponse,
} from '../../third_party/index.js';
import type {
  BuiltReplayRequest,
  GetNetworkRequestData,
  ReplayOverride,
  ReplayResponse,
} from './types.js';

/** 由 APIRequestContext 管理的 hop-by-hop / transport 头，重放时剥离。 */
export const STRIPPED_HEADERS = [
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
] as const;

const STRIPPED_HEADERS_LOWER = new Set<string>(STRIPPED_HEADERS);

/**
 * 剥离由 APIRequestContext 管理的传输层头（大小写不敏感）。
 * 签名相关头（sign/signature/x-sign/token/auth/nonce/timestamp 等）原样保留。
 */
export function stripManagedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS_LOWER.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Add failing tests for `buildReplayRequest`**

Append to `tests/unit/tools/network/replayEngine.test.ts` (before the final closing — add a new `describe` block, and add `buildReplayRequest` to the import at top):

```typescript
// Update the import at the top of the file:
import {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
} from '../../../../src/tools/network/replayEngine.js';
import type {GetNetworkRequestData} from '../../../../src/tools/network/types.js';

const ORIGINAL: GetNetworkRequestData = {
  reqid: 1,
  url: 'https://api.example.com/v1/sign',
  method: 'POST',
  resourceType: 'xhr',
  statusCode: 200,
  requestHeaders: {
    'Content-Type': 'application/json',
    'X-Sign': 'original-signature',
    Host: 'api.example.com',
  },
  responseHeaders: {},
  postData: '{"foo":"bar"}',
};

describe('buildReplayRequest', () => {
  it('mirrors original when no override given (method uppercased, headers stripped)', () => {
    const built = buildReplayRequest(ORIGINAL);
    assert.equal(built.method, 'POST');
    assert.equal(built.url, 'https://api.example.com/v1/sign');
    assert.deepStrictEqual(built.headers, {
      'Content-Type': 'application/json',
      'X-Sign': 'original-signature',
    });
    assert.equal(built.body, '{"foo":"bar"}');
  });

  it('merges override headers case-insensitively (override wins, keeps override casing)', () => {
    const built = buildReplayRequest(ORIGINAL, {
      headers: {'content-type': 'text/plain', 'X-Extra': 'val'},
    });
    assert.deepStrictEqual(built.headers, {
      'content-type': 'text/plain',
      'X-Sign': 'original-signature',
      'X-Extra': 'val',
    });
  });

  it('replaces headers wholesale when replaceHeaders=true', () => {
    const built = buildReplayRequest(ORIGINAL, {
      headers: {'X-Only': 'val'},
      replaceHeaders: true,
    });
    assert.deepStrictEqual(built.headers, {'X-Only': 'val'});
  });

  it('overrides method (uppercased) and url', () => {
    const built = buildReplayRequest(ORIGINAL, {
      method: 'put',
      url: 'https://api.example.com/v2/sign',
    });
    assert.equal(built.method, 'PUT');
    assert.equal(built.url, 'https://api.example.com/v2/sign');
  });

  it('keeps original body when body omitted', () => {
    const built = buildReplayRequest(ORIGINAL, {method: 'POST'});
    assert.equal(built.body, '{"foo":"bar"}');
  });

  it('clears body when body=null', () => {
    const built = buildReplayRequest(ORIGINAL, {body: null});
    assert.equal(built.body, undefined);
  });

  it('replaces body when body=string', () => {
    const built = buildReplayRequest(ORIGINAL, {body: '{"x":1}'});
    assert.equal(built.body, '{"x":1}');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: FAIL — `buildReplayRequest is not a function`

- [ ] **Step 7: Implement `buildReplayRequest` in `replayEngine.ts`**

Append to `src/tools/network/replayEngine.ts`:

```typescript
/**
 * 根据原始请求和可选覆盖构建重放请求。
 *
 * - method: override.method?.toUpperCase() ?? original.method
 * - url: override.url ?? original.url
 * - headers: 默认合并（override 大小写不敏感地覆盖同名键，保留 override 大小写）；
 *            replaceHeaders=true 时整体替换。最终都过 stripManagedHeaders。
 * - body: override.body !== undefined ? (override.body ?? undefined) : original.postData
 *         （null 显式清空，省略保留原始）
 */
export function buildReplayRequest(
  original: GetNetworkRequestData,
  override?: ReplayOverride,
): BuiltReplayRequest {
  const method = override?.method?.toUpperCase() ?? original.method;
  const url = override?.url ?? original.url;

  let headers: Record<string, string>;
  if (override?.replaceHeaders === true) {
    headers = {...(override.headers ?? {})};
  } else {
    headers = mergeHeaders(original.requestHeaders, override?.headers);
  }
  headers = stripManagedHeaders(headers);

  const body =
    override?.body !== undefined ? override.body ?? undefined : original.postData;

  return {method, url, headers, body};
}

function mergeHeaders(
  original: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> {
  if (!override) {
    return {...original};
  }
  const result: Record<string, string> = {...original};
  const originalKeysLower = new Map(
    Object.keys(original).map(k => [k.toLowerCase(), k]),
  );
  for (const [overrideKey, overrideValue] of Object.entries(override)) {
    const lower = overrideKey.toLowerCase();
    const existingKey = originalKeysLower.get(lower);
    if (existingKey !== undefined && existingKey !== overrideKey) {
      delete result[existingKey];
    }
    result[overrideKey] = overrideValue;
  }
  return result;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: PASS (all 12 tests)

- [ ] **Step 9: Add failing tests for `emptyReplayResponse`**

Append to the test file (add `emptyReplayResponse` to imports):

```typescript
import {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
} from '../../../../src/tools/network/replayEngine.js';

describe('emptyReplayResponse', () => {
  it('returns zero-shell with replayedUrl set from arg', () => {
    assert.deepStrictEqual(emptyReplayResponse('https://x.test/y'), {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      bodyTruncated: false,
      timingMs: 0,
      replayedUrl: 'https://x.test/y',
    });
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: FAIL — `emptyReplayResponse is not a function`

- [ ] **Step 11: Implement `emptyReplayResponse`**

Append to `src/tools/network/replayEngine.ts`:

```typescript
/** 构建一个全零的 ReplayResponse，用于失败 variant 的占位。 */
export function emptyReplayResponse(url: string): ReplayResponse {
  return {
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    bodyTruncated: false,
    timingMs: 0,
    replayedUrl: url,
  };
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: PASS (all 13 tests)

- [ ] **Step 13: Add failing tests for `executeReplay`**

Append to the test file (add `executeReplay` to imports):

```typescript
import {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
} from '../../../../src/tools/network/replayEngine.js';

function createMockApiContext(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  throwOnFetch?: Error;
  throwOnBody?: Error;
}): APIRequestContext {
  const mockResponse = {
    status: () => opts.status ?? 200,
    statusText: () => opts.statusText ?? 'OK',
    headers: () => opts.headers ?? {'content-type': 'application/json'},
    text: async () => {
      if (opts.throwOnBody) {
        throw opts.throwOnBody;
      }
      return opts.body ?? '{"ok":true}';
    },
  };
  return {
    fetch: async () => {
      if (opts.throwOnFetch) {
        throw opts.throwOnFetch;
      }
      return mockResponse;
    },
  } as unknown as APIRequestContext;
}

describe('executeReplay', () => {
  it('returns normalized response on success', async () => {
    const ctx = createMockApiContext({
      status: 200,
      statusText: 'OK',
      headers: {'content-type': 'application/json'},
      body: '{"ok":true}',
    });
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {'X-Sign': 's'},
      body: '{"a":1}',
    };
    const result = await executeReplay(ctx, built, 2000);
    assert.equal(result.status, 200);
    assert.equal(result.statusText, 'OK');
    assert.equal(result.body, '{"ok":true}');
    assert.equal(result.bodyTruncated, false);
    assert.equal(result.replayedUrl, 'https://x.test/y');
    assert.equal(typeof result.timingMs, 'number');
    assert.ok(result.timingMs >= 0);
  });

  it('truncates body when exceeding maxBodyLength', async () => {
    const ctx = createMockApiContext({body: '0123456789'});
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const result = await executeReplay(ctx, built, 5);
    assert.equal(result.body, '01234\n... [truncated]');
    assert.equal(result.bodyTruncated, true);
  });

  it('falls back to empty body when body read fails', async () => {
    const ctx = createMockApiContext({
      status: 200,
      throwOnBody: new Error('body read failed'),
    });
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const result = await executeReplay(ctx, built, 2000);
    assert.equal(result.status, 200);
    assert.equal(result.body, '');
    assert.equal(result.bodyTruncated, false);
  });

  it('propagates fetch errors with original message', async () => {
    const ctx = createMockApiContext({
      throwOnFetch: new Error('network down'),
    });
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {},
    };
    await assert.rejects(
      executeReplay(ctx, built, 2000),
      /network down/,
    );
  });
});
```

Also add these imports at the top of the test file:

```typescript
import type {
  APIRequestContext,
} from '../../../../src/third_party/index.js';
import type {
  BuiltReplayRequest,
} from '../../../../src/tools/network/types.js';
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: FAIL — `executeReplay is not a function`

- [ ] **Step 15: Implement `executeReplay`**

Append to `src/tools/network/replayEngine.ts`:

```typescript
/**
 * 通过 APIRequestContext 发起重放请求，返回归一化响应。
 *
 * - 复用浏览器 context 的 cookie/storage/UA，绕过 CORS 和页面 JS 拦截器。
 * - 网络错误抛出（由调用方捕获并附加到 BatchVariantResult.error 或单重放错误路径）。
 * - 响应体读取失败时回退为空字符串。
 */
export async function executeReplay(
  apiCtx: APIRequestContext,
  built: BuiltReplayRequest,
  maxBodyLength: number,
): Promise<ReplayResponse> {
  const started = Date.now();
  const resp: APIResponse = await apiCtx.fetch(built.url, {
    method: built.method,
    headers: built.headers,
    data: built.body,
  });

  const status = resp.status();
  const statusText = (() => {
    try {
      return resp.statusText?.() ?? '';
    } catch {
      return '';
    }
  })();
  const headers = resp.headers();

  let body = '';
  let bodyTruncated = false;
  try {
    const fullBody = await resp.text();
    if (fullBody.length > maxBodyLength) {
      body = fullBody.slice(0, maxBodyLength) + '\n... [truncated]';
      bodyTruncated = true;
    } else {
      body = fullBody;
    }
  } catch {
    // body 读取失败，回退为空
  }

  return {
    status,
    statusText,
    headers,
    body,
    bodyTruncated,
    timingMs: Date.now() - started,
    replayedUrl: built.url,
  };
}
```

- [ ] **Step 16: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: PASS (all 17 tests)

- [ ] **Step 17: Add failing tests for `formatCurl`**

Append to the test file (add `formatCurl` to imports):

```typescript
import {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
  formatCurl,
} from '../../../../src/tools/network/replayEngine.js';

describe('formatCurl', () => {
  it('emits GET without -X', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {'X-A': '1'},
    };
    assert.equal(
      formatCurl(built, {}),
      "curl 'https://x.test/y' -H 'X-A: 1'",
    );
  });

  it('emits -X POST and --data when body present', () => {
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {'X-A': '1'},
      body: '{"a":1}',
    };
    assert.equal(
      formatCurl(built, {}),
      "curl -X POST 'https://x.test/y' -H 'X-A: 1' --data '{\"a\":1}'",
    );
  });

  it('omits --data when body empty', () => {
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {},
    };
    assert.equal(
      formatCurl(built, {}),
      "curl -X POST 'https://x.test/y'",
    );
  });

  it('escapes single quotes in URL, header values, and body', () => {
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: "https://x.test/it's",
      headers: {"X-Q": "va'lue"},
      body: "{'k':'v'}",
    };
    const curl = formatCurl(built, {});
    assert.ok(curl.includes("'https://x.test/it'\\''s'"));
    assert.ok(curl.includes("-H 'X-Q: va'\\''lue'"));
    assert.ok(curl.includes("--data '{'\\''k'\\'':'\\''v'\\'''}'"));
  });

  it('appends Cookie header when includeCookies=true and cookies provided', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const curl = formatCurl(built, {
      includeCookies: true,
      cookies: [
        {name: 'session', value: 'abc'},
        {name: 'csrf', value: 'xyz'},
      ],
    });
    assert.ok(curl.includes("-H 'Cookie: session=abc; csrf=xyz'"));
  });

  it('omits Cookie header when includeCookies=false', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const curl = formatCurl(built, {
      includeCookies: false,
      cookies: [{name: 'session', value: 'abc'}],
    });
    assert.ok(!curl.includes('Cookie'));
  });

  it('omits Cookie header when cookies array empty', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const curl = formatCurl(built, {includeCookies: true, cookies: []});
    assert.ok(!curl.includes('Cookie'));
  });
});
```

- [ ] **Step 18: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: FAIL — `formatCurl is not a function`

- [ ] **Step 19: Implement `formatCurl`**

Append to `src/tools/network/replayEngine.ts`:

```typescript
interface FormatCurlOptions {
  includeCookies?: boolean;
  cookies?: Array<{name: string; value: string}>;
}

/**
 * 将构建好的请求格式化为单行 sh 风格 curl 命令。
 *
 * - GET 省略 -X（curl 默认）。
 * - 单引号转义：' → '\''。
 * - body 非空时附加 --data。
 * - includeCookies=true 且 cookies 非空时附加 Cookie 头。
 * - 不加 --compressed/--insecure/--silent，保持最小输出。
 */
export function formatCurl(
  built: BuiltReplayRequest,
  opts: FormatCurlOptions,
): string {
  const parts: string[] = ['curl'];

  if (built.method.toUpperCase() !== 'GET') {
    parts.push(`-X ${built.method.toUpperCase()}`);
  }

  parts.push(quote(built.url));

  for (const [key, value] of Object.entries(built.headers)) {
    parts.push(`-H ${quote(`${key}: ${value}`)}`);
  }

  if (opts.includeCookies && opts.cookies && opts.cookies.length > 0) {
    const cookieStr = opts.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    parts.push(`-H ${quote(`Cookie: ${cookieStr}`)}`);
  }

  if (built.body) {
    parts.push(`--data ${quote(built.body)}`);
  }

  return parts.join(' ');
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
```

- [ ] **Step 20: Run full engine tests to verify all pass**

Run: `npx tsx --test tests/unit/tools/network/replayEngine.test.ts`
Expected: PASS (all 24 tests)

- [ ] **Step 21: Run typecheck and format check**

Run: `npm run typecheck && npm run check-format`
Expected: PASS. If format fails, run `npm run format` and re-stage.

- [ ] **Step 22: Commit**

```bash
git add src/tools/network/replayEngine.ts tests/unit/tools/network/replayEngine.test.ts
git commit -m "feat(network): add replayEngine pure module with strip/build/execute/formatCurl"
```

---

### Task 3: Implement `replay_network_request` tool

**Files:**
- Create: `src/tools/network/replayNetworkRequest.ts`
- Test: `tests/unit/tools/network/replayNetworkRequest.test.ts`

**Interfaces:**
- Consumes: `defineTool` from `../ToolDefinition.js`; `getRuntime` from `../../runtime.js`; `zod`, `ToolCategory` from third_party/categories; `buildReplayRequest`, `executeReplay`, `emptyReplayResponse` from `./replayEngine.js`; types from `./types.js`.
- Produces: exported `replayNetworkRequest` tool (consumed by Task 6's `manifest.ts` and `index.ts`).

- [ ] **Step 1: Write failing tests**

Create `tests/unit/tools/network/replayNetworkRequest.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it, mock} from 'node:test';

import {replayNetworkRequest} from '../../../../src/tools/network/replayNetworkRequest.js';

// Mock replayEngine — we verify wiring, not engine internals (tested separately).
const buildReplayRequestMock = mock.fn(() => ({
  method: 'POST',
  url: 'https://x.test/y',
  headers: {'X-Sign': 's'},
  body: '{"a":1}',
}));
const executeReplayMock = mock.fn(async () => ({
  status: 200,
  statusText: 'OK',
  headers: {'content-type': 'application/json'},
  body: '{"ok":true}',
  bodyTruncated: false,
  timingMs: 12,
  replayedUrl: 'https://x.test/y',
}));

mock.module(
  '../../../../src/tools/network/replayEngine.js',
  () => ({
    buildReplayRequest: buildReplayRequestMock,
    executeReplay: executeReplayMock,
    emptyReplayResponse: (url: string) => ({
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      bodyTruncated: false,
      timingMs: 0,
      replayedUrl: url,
    }),
  }),
);

interface TestRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  resourceType(): string;
  headers(): Record<string, string>;
  response(): Promise<{
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  }>;
}

function createMockRequest(): TestRequest {
  return {
    url: () => 'https://x.test/y',
    method: () => 'POST',
    postData: () => '{"foo":"bar"}',
    resourceType: () => 'xhr',
    headers: () => ({'X-Sign': 'original-signature', 'Content-Type': 'application/json'}),
    response: async () => ({
      status: () => 200,
      headers: () => ({}),
    }),
  };
}

function createMockResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (c: unknown) => lines.push(JSON.stringify(c)),
  };
}

function parseResult(r: ReturnType<typeof createMockResponse>): any {
  const jsonLine = r.lines.find(l => l.trim().startsWith('{'));
  if (!jsonLine) throw new Error('No JSON in response');
  return JSON.parse(jsonLine);
}

function createMockContext(overrides: {
  page?: {context: () => {request: unknown}};
  getRequestById?: (id: number) => unknown;
} = {}) {
  const defaultPage = {
    context: () => ({request: {}}),
  };
  return {
    getSelectedPage: () => overrides.page ?? defaultPage,
    getNetworkRequestById: overrides.getRequestById ?? (() => createMockRequest()),
  } as any;
}

describe('replay_network_request', () => {
  it('returns success and echoes override on happy path', async () => {
    const ctx = createMockContext();
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 5, headers: {'X-Test': '1'}}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'replay_network_request');
    assert.equal(result.data.status, 200);
    assert.equal(result.data.originalReqid, 5);
    assert.equal(result.data.body, '{"ok":true}');
    assert.equal(result.data.headers['content-type'], 'application/json');
    assert.equal(result.data.override.headers['X-Test'], '1');
    assert.match(result.message, /200/);
  });

  it('returns failure when reqid is invalid (getNetworkRequestById throws)', async () => {
    const ctx = createMockContext({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 999}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.originalReqid, 999);
    assert.equal(result.data.status, 0);
  });

  it('returns failure when executeReplay throws', async () => {
    executeReplayMock.mock.mockImplementation(async () => {
      throw new Error('network down');
    });
    const ctx = createMockContext();
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 1}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /network down/);

    // restore mock
    executeReplayMock.mock.restoreDefaultImplementation();
  });

  it('passes override to buildReplayRequest and page.context().request to executeReplay', async () => {
    buildReplayRequestMock.mock.clearCalls();
    executeReplayMock.mock.clearCalls();
    const requestObj = {fetch: async () => {}};
    const page = {context: () => ({request: requestObj})};
    const ctx = createMockContext({page});

    await replayNetworkRequest.handler(
      {params: {reqid: 7, method: 'PUT', url: 'https://z.test/w'}} as any,
      createMockResponse() as any,
      ctx,
    );

    assert.equal(buildReplayRequestMock.mock.calls.length, 1);
    const [originalArg, overrideArg] = buildReplayRequestMock.mock.calls[0].arguments;
    assert.equal(originalArg.url, 'https://x.test/y');
    assert.equal(overrideArg.method, 'PUT');
    assert.equal(overrideArg.url, 'https://z.test/w');

    assert.equal(executeReplayMock.mock.calls.length, 1);
    const [apiCtxArg] = executeReplayMock.mock.calls[0].arguments;
    assert.equal(apiCtxArg, requestObj);
  });

  it('applies default maxBodyLength=2000 when omitted', async () => {
    executeReplayMock.mock.clearCalls();
    const ctx = createMockContext();

    await replayNetworkRequest.handler(
      {params: {reqid: 1}} as any,
      createMockResponse() as any,
      ctx,
    );

    const [, , maxBodyArg] = executeReplayMock.mock.calls[0].arguments;
    assert.equal(maxBodyArg, 2000);
  });

  it('applies custom maxBodyLength when provided', async () => {
    executeReplayMock.mock.clearCalls();
    const ctx = createMockContext();

    await replayNetworkRequest.handler(
      {params: {reqid: 1, maxBodyLength: 500}} as any,
      createMockResponse() as any,
      ctx,
    );

    const [, , maxBodyArg] = executeReplayMock.mock.calls[0].arguments;
    assert.equal(maxBodyArg, 500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayNetworkRequest.test.ts`
Expected: FAIL — `Cannot find module '...replayNetworkRequest.js'`

- [ ] **Step 3: Implement `src/tools/network/replayNetworkRequest.ts`**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
} from './replayEngine.js';
import type {
  GetNetworkRequestData,
  ReplayNetworkRequestParams,
  ReplayOverride,
} from './types.js';

const DEFAULT_MAX_BODY_LENGTH = 2000;

function buildOriginalData(
  reqid: number,
  networkRequest: {
    url(): string;
    method(): string;
    postData(): string | null;
    resourceType(): string;
    headers(): Record<string, string>;
  },
  httpResponse: {
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  } | null,
): GetNetworkRequestData {
  return {
    reqid,
    url: networkRequest.url(),
    method: networkRequest.method(),
    resourceType: networkRequest.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    statusText: httpResponse?.statusText?.(),
    requestHeaders: networkRequest.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    postData: networkRequest.postData() ?? undefined,
  };
}

export const replayNetworkRequest = defineTool({
  name: 'replay_network_request',
  description:
    "Replay a captured network request (by reqid) using the browser context's cookies and storage. Supports overriding method, url, headers, and body. Useful for verifying signature field effects and parameter validity.",
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe(
        'The reqid of the captured network request to replay. Use list_network_requests to find it.',
      ),
    method: zod
      .string()
      .optional()
      .describe(
        'Override the HTTP method (e.g. POST, GET). Defaults to the original method.',
      ),
    url: zod
      .string()
      .optional()
      .describe('Override the request URL. Defaults to the original URL.'),
    headers: zod
      .record(zod.string(), zod.string())
      .optional()
      .describe(
        'Headers to merge with the original (override wins on key collision, case-insensitive). Set replaceHeaders=true to replace wholesale.',
      ),
    body: zod
      .string()
      .nullable()
      .optional()
      .describe(
        'Override the request body. null clears the body. Omit to keep the original. Only meaningful for POST/PUT/PATCH.',
      ),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        'If true, the headers param replaces the original headers entirely. Default false (merge).',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum length of the response body to return. Defaults to 2000 characters.',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params as ReplayNetworkRequestParams;
    const reqid = params.reqid;

    try {
      const page = context.getSelectedPage();
      const networkRequest = context.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(reqid, networkRequest, httpResponse);

      const override: ReplayOverride = {
        method: params.method,
        url: params.url,
        headers: params.headers,
        body: params.body,
        replaceHeaders: params.replaceHeaders,
      };

      const built = buildReplayRequest(originalData, override);
      const maxBodyLength = params.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;

      try {
        const result = await executeReplay(
          page.context().request,
          built,
          maxBodyLength,
        );

        response.setStructuredContent({
          success: true,
          message: `请求重放成功：HTTP ${result.status}`,
          tooltype: 'replay_network_request',
          data: {
            ...result,
            originalReqid: reqid,
            override,
          },
        });
      } catch (execError) {
        response.setStructuredContent({
          success: false,
          message: `请求重放失败：${
            execError instanceof Error ? execError.message : String(execError)
          }`,
          tooltype: 'replay_network_request',
          data: {
            ...emptyReplayResponse(built.url),
            originalReqid: reqid,
            override,
          },
        });
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `请求重放失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        tooltype: 'replay_network_request',
        data: {
          ...emptyReplayResponse(''),
          originalReqid: reqid,
          override: null,
        },
      });
    }
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/replayNetworkRequest.test.ts`
Expected: PASS (all 6 tests). If the `mock.module` approach doesn't work with `tsx`, switch to direct mocking by importing the real `replayEngine` and using its real functions (they're pure and won't make network calls without a real `APIRequestContext`). The test for "executeReplay throws" can pass a mock `APIRequestContext` whose `fetch` rejects.

If `mock.module` is unavailable, replace the mock setup with: remove the `mock.module(...)` block and the `mock.fn` imports; let tests use the real `replayEngine`; for the "executeReplay throws" test, pass a mock context whose page's `context().request.fetch` rejects with `new Error('network down')`.

- [ ] **Step 5: Run typecheck and format check**

Run: `npm run typecheck && npm run check-format`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/network/replayNetworkRequest.ts tests/unit/tools/network/replayNetworkRequest.test.ts
git commit -m "feat(network): add replay_network_request tool"
```

---

### Task 4: Implement `export_request_as_curl` tool

**Files:**
- Create: `src/tools/network/exportRequestAsCurl.ts`
- Test: `tests/unit/tools/network/exportRequestAsCurl.test.ts`

**Interfaces:**
- Consumes: same as Task 3 plus `formatCurl` from `./replayEngine.js`; `page.context().cookies()` for cookie extraction.
- Produces: exported `exportRequestAsCurl` tool (consumed by Task 6).

- [ ] **Step 1: Write failing tests**

Create `tests/unit/tools/network/exportRequestAsCurl.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {exportRequestAsCurl} from '../../../../src/tools/network/exportRequestAsCurl.js';

interface TestRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  resourceType(): string;
  headers(): Record<string, string>;
  response(): Promise<{
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  }>;
}

function createMockRequest(): TestRequest {
  return {
    url: () => 'https://api.example.com/v1/sign',
    method: () => 'POST',
    postData: () => '{"foo":"bar"}',
    resourceType: () => 'xhr',
    headers: () => ({
      'X-Sign': 'original-signature',
      'Content-Type': 'application/json',
      Host: 'api.example.com',
    }),
    response: async () => ({
      status: () => 200,
      headers: () => ({}),
    }),
  };
}

function createMockResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (c: unknown) => lines.push(JSON.stringify(c)),
  };
}

function parseResult(r: ReturnType<typeof createMockResponse>): any {
  const jsonLine = r.lines.find(l => l.trim().startsWith('{'));
  if (!jsonLine) throw new Error('No JSON in response');
  return JSON.parse(jsonLine);
}

function createMockContext(overrides: {
  cookies?: Array<{name: string; value: string; domain: string}>;
  cookiesThrow?: boolean;
  getRequestById?: (id: number) => unknown;
} = {}) {
  const page = {
    context: () => ({
      cookies: async () => {
        if (overrides.cookiesThrow) {
          throw new Error('cookie read failed');
        }
        return overrides.cookies ?? [];
      },
    }),
  };
  return {
    getSelectedPage: () => page,
    getNetworkRequestById:
      overrides.getRequestById ?? (() => createMockRequest()),
  } as any;
}

describe('export_request_as_curl', () => {
  it('exports curl without Cookie header when includeCookies omitted', async () => {
    const ctx = createMockContext();
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'export_request_as_curl');
    assert.equal(result.data.originalReqid, 5);
    assert.equal(result.data.override, null);
    assert.ok(result.data.curl.startsWith("curl -X POST 'https://api.example.com/v1/sign'"));
    assert.ok(result.data.curl.includes("-H 'X-Sign: original-signature'"));
    assert.ok(result.data.curl.includes("-H 'Content-Type: application/json'"));
    assert.ok(!result.data.curl.includes('Host:'), 'Host header should be stripped');
    assert.ok(result.data.curl.includes("--data '{\"foo\":\"bar\"}'"));
    assert.ok(!result.data.curl.includes('Cookie'));
  });

  it('exports curl with Cookie header when includeCookies=true and cookies match domain', async () => {
    const ctx = createMockContext({
      cookies: [
        {name: 'session', value: 'abc', domain: 'api.example.com'},
        {name: 'other', value: 'xyz', domain: 'other.test'},
      ],
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.ok(result.data.curl.includes("-H 'Cookie: session=abc'"));
    assert.ok(!result.data.curl.includes('xyz'), 'other.test cookie should be filtered out');
  });

  it('matches cookies on subdomain (api.example.com cookie matches sub.api.example.com URL)', async () => {
    // Build a request whose URL is sub.api.example.com
    const ctx = createMockContext({
      cookies: [{name: 's', value: 'v', domain: 'api.example.com'}],
      getRequestById: () => ({
        ...createMockRequest(),
        url: () => 'https://sub.api.example.com/v1/sign',
      }),
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.ok(result.data.curl.includes("Cookie: s=v"));
  });

  it('does not match cookies on lookalike domain (example.com cookie does not match evil-example.com)', async () => {
    const ctx = createMockContext({
      cookies: [{name: 's', value: 'v', domain: 'example.com'}],
      getRequestById: () => ({
        ...createMockRequest(),
        url: () => 'https://evil-example.com/v1/sign',
      }),
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.ok(!result.data.curl.includes('Cookie'));
  });

  it('proceeds without cookies and notes failure when cookies() throws', async () => {
    const ctx = createMockContext({cookiesThrow: true});
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.ok(!result.data.curl.includes('Cookie'));
    assert.match(result.message, /Cookie 读取失败/);
  });

  it('returns failure when reqid is invalid', async () => {
    const ctx = createMockContext({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 999}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.curl, '');
    assert.equal(result.data.originalReqid, 999);
  });

  it('applies overrides when building the curl command', async () => {
    const ctx = createMockContext();
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {
        params: {
          reqid: 5,
          method: 'PUT',
          url: 'https://api.example.com/v2/sign',
          headers: {'X-Test': '1'},
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.ok(result.data.curl.startsWith("curl -X PUT 'https://api.example.com/v2/sign'"));
    assert.ok(result.data.curl.includes("-H 'X-Test: 1'"));
    assert.equal(result.data.override.method, 'PUT');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/exportRequestAsCurl.test.ts`
Expected: FAIL — `Cannot find module '...exportRequestAsCurl.js'`

- [ ] **Step 3: Implement `src/tools/network/exportRequestAsCurl.ts`**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {buildReplayRequest, formatCurl} from './replayEngine.js';
import type {
  ExportRequestAsCurlParams,
  GetNetworkRequestData,
  ReplayOverride,
} from './types.js';

function buildOriginalData(
  reqid: number,
  networkRequest: {
    url(): string;
    method(): string;
    postData(): string | null;
    resourceType(): string;
    headers(): Record<string, string>;
  },
  httpResponse: {
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  } | null,
): GetNetworkRequestData {
  return {
    reqid,
    url: networkRequest.url(),
    method: networkRequest.method(),
    resourceType: networkRequest.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    statusText: httpResponse?.statusText?.(),
    requestHeaders: networkRequest.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    postData: networkRequest.postData() ?? undefined,
  };
}

/** Cookie 域匹配：host 等于 domain，或 host 以 "." + domain 结尾。 */
function cookieMatchesHost(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase();
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

export const exportRequestAsCurl = defineTool({
  name: 'export_request_as_curl',
  description:
    'Export a captured network request (by reqid) as a curl command. Supports the same overrides as replay_network_request. Useful for reproducing a request outside the browser or verifying that an exported command reproduces the captured response.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('The reqid of the captured network request to export.'),
    method: zod
      .string()
      .optional()
      .describe('Override the HTTP method.'),
    url: zod
      .string()
      .optional()
      .describe('Override the request URL.'),
    headers: zod
      .record(zod.string(), zod.string())
      .optional()
      .describe(
        'Headers to merge with the original (override wins on key collision, case-insensitive). Set replaceHeaders=true to replace wholesale.',
      ),
    body: zod
      .string()
      .nullable()
      .optional()
      .describe('Override the request body. null clears the body.'),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        'If true, the headers param replaces the original headers entirely. Default false (merge).',
      ),
    includeCookies: zod
      .boolean()
      .optional()
      .describe(
        'If true, embed cookies from the browser context as a Cookie header in the curl command. Default false (cookies are session-bound and may be sensitive).',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params as ExportRequestAsCurlParams;
    const reqid = params.reqid;

    try {
      const page = context.getSelectedPage();
      const networkRequest = context.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(reqid, networkRequest, httpResponse);

      const override: ReplayOverride = {
        method: params.method,
        url: params.url,
        headers: params.headers,
        body: params.body,
        replaceHeaders: params.replaceHeaders,
      };

      const built = buildReplayRequest(originalData, override);

      let cookies: Array<{name: string; value: string}> | undefined;
      let cookieNote = '';
      if (params.includeCookies === true) {
        try {
          const allCookies = await page.context().cookies();
          let host: string;
          try {
            host = new URL(built.url).hostname;
          } catch {
            host = '';
          }
          cookies = allCookies
            .filter(c => cookieMatchesHost(c.domain, host))
            .map(c => ({name: c.name, value: c.value}));
        } catch {
          cookieNote = '（Cookie 读取失败，已省略）';
        }
      }

      const curl = formatCurl(built, {
        includeCookies: params.includeCookies === true,
        cookies,
      });

      response.setStructuredContent({
        success: true,
        message: `已导出 curl 命令${cookieNote}`,
        tooltype: 'export_request_as_curl',
        data: {
          curl,
          originalReqid: reqid,
          override,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `导出 curl 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        tooltype: 'export_request_as_curl',
        data: {
          curl: '',
          originalReqid: reqid,
          override: null,
        },
      });
    }
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/exportRequestAsCurl.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Run typecheck and format check**

Run: `npm run typecheck && npm run check-format`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/network/exportRequestAsCurl.ts tests/unit/tools/network/exportRequestAsCurl.test.ts
git commit -m "feat(network): add export_request_as_curl tool"
```

---

### Task 5: Implement `replay_network_request_batch` tool

**Files:**
- Create: `src/tools/network/replayNetworkRequestBatch.ts`
- Test: `tests/unit/tools/network/replayNetworkRequestBatch.test.ts`

**Interfaces:**
- Consumes: `buildReplayRequest`, `executeReplay`, `emptyReplayResponse` from `./replayEngine.js`; types from `./types.js`.
- Produces: exported `replayNetworkRequestBatch` tool (consumed by Task 6).

- [ ] **Step 1: Write failing tests**

Create `tests/unit/tools/network/replayNetworkRequestBatch.test.ts`:

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {replayNetworkRequestBatch} from '../../../../src/tools/network/replayNetworkRequestBatch.js';

interface TestRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  resourceType(): string;
  headers(): Record<string, string>;
  response(): Promise<{
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  }>;
}

function createMockRequest(): TestRequest {
  return {
    url: () => 'https://x.test/y',
    method: () => 'POST',
    postData: () => '{"foo":"bar"}',
    resourceType: () => 'xhr',
    headers: () => ({'X-Sign': 's'}),
    response: async () => ({status: () => 200, headers: () => ({})}),
  };
}

function createMockResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (c: unknown) => lines.push(JSON.stringify(c)),
  };
}

function parseResult(r: ReturnType<typeof createMockResponse>): any {
  const jsonLine = r.lines.find(l => l.trim().startsWith('{'));
  if (!jsonLine) throw new Error('No JSON in response');
  return JSON.parse(jsonLine);
}

/** Builds a mock context whose page.context().request.fetch returns per-variant statuses. */
function createMockContext(opts: {
  statuses?: number[];        // per-variant fetch status; default all 200
  throwOnVariant?: number;    // variant index that should throw on fetch
  getRequestById?: (id: number) => unknown;
} = {}) {
  let callIdx = -1;
  const fetchCalls: number[] = [];
  const requestObj = {
    fetch: async () => {
      callIdx++;
      fetchCalls.push(callIdx);
      if (opts.throwOnVariant === callIdx) {
        throw new Error(`fetch failed on variant ${callIdx}`);
      }
      const status = opts.statuses?.[callIdx] ?? 200;
      return {
        status: () => status,
        statusText: () => 'OK',
        headers: () => ({}),
        text: async () => `body-${callIdx}`,
      };
    },
  };
  const page = {context: () => ({request: requestObj})};
  return {
    ctx: {
      getSelectedPage: () => page,
      getNetworkRequestById:
        opts.getRequestById ?? (() => createMockRequest()),
    } as any,
    fetchCalls,
  };
}

describe('replay_network_request_batch', () => {
  it('executes all variants with concurrency=1 and aggregates results', async () => {
    const {ctx, fetchCalls} = createMockContext({statuses: [200, 200, 200]});
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {
        params: {
          reqid: 1,
          variants: [
            {headers: {'X-A': '1'}},
            {headers: {'X-A': '2'}},
            {headers: {'X-A': '3'}},
          ],
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'replay_network_request_batch');
    assert.equal(result.data.total, 3);
    assert.equal(result.data.succeeded, 3);
    assert.equal(result.data.failed, 0);
    assert.deepStrictEqual(result.data.statusCodeDistribution, {200: 3});
    assert.equal(result.data.results.length, 3);
    assert.equal(result.data.results[0].index, 0);
    assert.equal(result.data.results[0].result.body, 'body-0');
    // Sequential: calls happen in order 0,1,2
    assert.deepStrictEqual(fetchCalls, [0, 1, 2]);
  });

  it('marks variant as failed when executeReplay throws, others succeed', async () => {
    const {ctx} = createMockContext({
      statuses: [200, 200, 200],
      throwOnVariant: 1,
    });
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {
        params: {
          reqid: 1,
          variants: [{}, {}, {}],
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.equal(result.data.total, 3);
    assert.equal(result.data.succeeded, 2);
    assert.equal(result.data.failed, 1);
    assert.equal(result.data.results[1].error, 'fetch failed on variant 1');
    assert.equal(result.data.results[1].result.status, 0);
    assert.equal(result.data.results[0].result.status, 200);
    assert.equal(result.data.results[2].result.status, 200);
  });

  it('builds statusCodeDistribution across mixed statuses', async () => {
    const {ctx} = createMockContext({statuses: [200, 500, 200]});
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {params: {reqid: 1, variants: [{}, {}, {}]}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.deepStrictEqual(result.data.statusCodeDistribution, {200: 2, 500: 1});
    assert.equal(result.data.succeeded, 3, 'HTTP 500 is not a failure');
    assert.equal(result.data.failed, 0);
    assert.equal(result.success, true);
  });

  it('executes with concurrency=3 across 5 variants (all complete, no gaps)', async () => {
    const {ctx} = createMockContext({statuses: [200, 200, 200, 200, 200]});
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {
        params: {
          reqid: 1,
          concurrency: 3,
          variants: [{}, {}, {}, {}, {}],
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.data.total, 5);
    assert.equal(result.data.succeeded, 5);
    const indexes = result.data.results.map((r: any) => r.index).sort((a: number, b: number) => a - b);
    assert.deepStrictEqual(indexes, [0, 1, 2, 3, 4]);
  });

  it('applies default maxBodyLength=500 when omitted', async () => {
    const {ctx} = createMockContext();
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {params: {reqid: 1, variants: [{}]}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.data.results[0].result.body, 'body-0');
    // body-0 is 6 chars, under 500 — no truncation
    assert.equal(result.data.results[0].result.bodyTruncated, false);
  });

  it('returns failure aggregate when reqid is invalid', async () => {
    const {ctx} = createMockContext({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {params: {reqid: 999, variants: [{}, {}]}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.total, 2);
    assert.equal(result.data.succeeded, 0);
    assert.equal(result.data.failed, 2);
    assert.deepStrictEqual(result.data.results, []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/unit/tools/network/replayNetworkRequestBatch.test.ts`
Expected: FAIL — `Cannot find module '...replayNetworkRequestBatch.js'`

- [ ] **Step 3: Implement `src/tools/network/replayNetworkRequestBatch.ts`**

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
} from './replayEngine.js';
import type {
  BatchVariantResult,
  GetNetworkRequestData,
  ReplayNetworkRequestBatchParams,
  ReplayOverride,
} from './types.js';

const DEFAULT_BATCH_MAX_BODY_LENGTH = 500;
const MAX_VARIANTS = 50;
const MAX_CONCURRENCY = 10;

function buildOriginalData(
  reqid: number,
  networkRequest: {
    url(): string;
    method(): string;
    postData(): string | null;
    resourceType(): string;
    headers(): Record<string, string>;
  },
  httpResponse: {
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  } | null,
): GetNetworkRequestData {
  return {
    reqid,
    url: networkRequest.url(),
    method: networkRequest.method(),
    resourceType: networkRequest.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    statusText: httpResponse?.statusText?.(),
    requestHeaders: networkRequest.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    postData: networkRequest.postData() ?? undefined,
  };
}

export const replayNetworkRequestBatch = defineTool({
  name: 'replay_network_request_batch',
  description:
    'Replay a captured network request multiple times with different overrides (variants). Useful for fuzzing signature fields, testing parameter boundaries, and observing response distribution. Sequential by default; bounded concurrency available.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('The reqid of the captured request to use as the template.'),
    variants: zod
      .array(
        zod.object({
          method: zod.string().optional(),
          url: zod.string().optional(),
          headers: zod.record(zod.string(), zod.string()).optional(),
          body: zod.string().nullable().optional(),
          replaceHeaders: zod.boolean().optional(),
        }),
      )
      .min(1)
      .max(MAX_VARIANTS)
      .describe(
        'Override variants to apply. Each variant produces one replay. Max 50 to bound runtime.',
      ),
    concurrency: zod
      .number()
      .int()
      .min(1)
      .max(MAX_CONCURRENCY)
      .optional()
      .describe(
        'Max parallel replays. Default 1 (sequential). Higher values risk server-side rate limiting.',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum length of each response body to return. Defaults to 500 (smaller than single-replay default since results aggregate).',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params as ReplayNetworkRequestBatchParams;
    const reqid = params.reqid;
    const variants = params.variants;
    const concurrency = params.concurrency ?? 1;
    const maxBodyLength = params.maxBodyLength ?? DEFAULT_BATCH_MAX_BODY_LENGTH;

    try {
      const page = context.getSelectedPage();
      const networkRequest = context.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(reqid, networkRequest, httpResponse);

      // Build all requests up front. Per-variant build errors are recorded, not thrown.
      const built: Array<{built: ReturnType<typeof buildReplayRequest>; override: ReplayOverride; buildError?: string}> = [];
      for (let i = 0; i < variants.length; i++) {
        const override = variants[i];
        try {
          built.push({built: buildReplayRequest(originalData, override), override});
        } catch (e) {
          built.push({
            built: {method: '', url: '', headers: {}},
            override,
            buildError: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const results: BatchVariantResult[] = new Array(variants.length);
      const queue = built.map((b, i) => ({...b, i}));
      const workers = Array.from(
        {length: Math.min(concurrency, variants.length)},
        async () => {
          while (queue.length > 0) {
            const next = queue.shift()!;
            if (next.buildError) {
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: emptyReplayResponse(next.built.url),
                error: next.buildError,
              };
              continue;
            }
            try {
              const r = await executeReplay(
                page.context().request,
                next.built,
                maxBodyLength,
              );
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: r,
              };
            } catch (e) {
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: emptyReplayResponse(next.built.url),
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }
        },
      );
      await Promise.all(workers);

      let succeeded = 0;
      let failed = 0;
      const statusCodeDistribution: Record<number, number> = {};
      for (const r of results) {
        if (r.error) {
          failed++;
        } else {
          succeeded++;
        }
        const status = r.result.status;
        statusCodeDistribution[status] = (statusCodeDistribution[status] ?? 0) + 1;
      }

      response.setStructuredContent({
        success: failed === 0,
        message: `批量重放完成：${succeeded}/${variants.length} 成功`,
        tooltype: 'replay_network_request_batch',
        data: {
          total: variants.length,
          succeeded,
          failed,
          statusCodeDistribution,
          results,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `批量重放失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        tooltype: 'replay_network_request_batch',
        data: {
          total: variants.length,
          succeeded: 0,
          failed: variants.length,
          statusCodeDistribution: {},
          results: [],
        },
      });
    }
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/unit/tools/network/replayNetworkRequestBatch.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Run typecheck and format check**

Run: `npm run typecheck && npm run check-format`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/network/replayNetworkRequestBatch.ts tests/unit/tools/network/replayNetworkRequestBatch.test.ts
git commit -m "feat(network): add replay_network_request_batch tool"
```

---

### Task 6: Register tools in manifest and re-export from index

**Files:**
- Modify: `src/tools/network/manifest.ts` (append 3 entries to `tools[]`)
- Modify: `src/tools/network/index.ts` (append tool exports + type re-exports)

**Interfaces:**
- Consumes: `replayNetworkRequest`, `exportRequestAsCurl`, `replayNetworkRequestBatch` from their respective files; new types from `./types.js`.
- Produces: tools registered in the MCP tool registry (visible to MCP clients); public exports from the network domain.

- [ ] **Step 1: Update `src/tools/network/manifest.ts`**

Append three entries to the `tools[]` array, after the existing `analyzeMessages.js` entry:

```typescript
{modulePath: './network/replayNetworkRequest.js', handlerName: 'replayNetworkRequest'},
{modulePath: './network/exportRequestAsCurl.js', handlerName: 'exportRequestAsCurl'},
{modulePath: './network/replayNetworkRequestBatch.js', handlerName: 'replayNetworkRequestBatch'},
```

The full file should look like:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'network',
  description: 'Network and WebSocket inspection tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './network/listNetworkRequests.js', handlerName: 'listNetworkRequests'},
    {modulePath: './network/getNetworkRequest.js', handlerName: 'getNetworkRequest'},
    {modulePath: './network/clearNetworkRequests.js', handlerName: 'clearNetworkRequests'},
    {modulePath: './network/listConnections.js', handlerName: 'listWebSocketConnections'},
    {modulePath: './network/getMessages.js', handlerName: 'getWebSocketMessages'},
    {modulePath: './network/getMessage.js', handlerName: 'getWebSocketMessage'},
    {modulePath: './network/analyzeMessages.js', handlerName: 'analyzeWebSocketMessages'},
    {modulePath: './network/replayNetworkRequest.js', handlerName: 'replayNetworkRequest'},
    {modulePath: './network/exportRequestAsCurl.js', handlerName: 'exportRequestAsCurl'},
    {modulePath: './network/replayNetworkRequestBatch.js', handlerName: 'replayNetworkRequestBatch'},
  ],
} satisfies DomainManifest;
```

- [ ] **Step 2: Update `src/tools/network/index.ts`**

Add tool exports after the `clearNetworkRequests` export line, and type re-exports after the existing `ClearNetworkRequestsResult`:

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Network 工具（defineTool 模式）──────────────────

export {listNetworkRequests} from './listNetworkRequests.js';
export {getNetworkRequest} from './getNetworkRequest.js';
export {clearNetworkRequests} from './clearNetworkRequests.js';
export {replayNetworkRequest} from './replayNetworkRequest.js';
export {exportRequestAsCurl} from './exportRequestAsCurl.js';
export {replayNetworkRequestBatch} from './replayNetworkRequestBatch.js';

// ─── WebSocket 工具（defineTool 模式）──────────────────

export {listWebSocketConnections} from './listConnections.js';
export {getWebSocketMessages} from './getMessages.js';
export {getWebSocketMessage} from './getMessage.js';
export {analyzeWebSocketMessages} from './analyzeMessages.js';

// ─── WebSocket Collector ──────────────────────────

export {WebSocketCollector} from './WebSocketCollector.js';
export type {
  WebSocketStatus,
  WebSocketDirection,
  WebSocketConnection,
  WebSocketFrame,
  WebSocketData,
} from './WebSocketCollector.js';

// ─── 类型导出 ─────────────────────────────────

export type {
  NetworkRuntimeServices,
  DevToolsData,
  RequestInitiator,
  ListNetworkRequestsParams,
  GetNetworkRequestParams,
  ClearNetworkRequestsParams,
  NetworkRequestData,
  ListNetworkRequestsData,
  NetworkEvidenceCorrelation,
  ClearNetworkRequestsData,
  GetNetworkRequestData,
  ListNetworkRequestsResult,
  GetNetworkRequestResult,
  ClearNetworkRequestsResult,
  // Replay 参数与数据类型
  ReplayOverride,
  BuiltReplayRequest,
  ReplayResponse,
  BatchVariantResult,
  BatchReplayResult,
  ReplayNetworkRequestParams,
  ReplayNetworkRequestData,
  ReplayNetworkRequestResult,
  ExportRequestAsCurlParams,
  ExportRequestAsCurlData,
  ExportRequestAsCurlResult,
  ReplayNetworkRequestBatchParams,
  ReplayNetworkRequestBatchData,
  ReplayNetworkRequestBatchResult,
  // WebSocket 参数类型
  ListWebSocketConnectionsParams,
  GetWebSocketMessagesParams,
  GetWebSocketMessageParams,
  AnalyzeWebSocketMessagesParams,
} from './types.js';
export {FILTERABLE_RESOURCE_TYPES} from './types.js';
```

- [ ] **Step 3: Run full unit test suite**

Run: `npm run test:unit`
Expected: PASS — all existing tests plus new replay tests (24 engine + 6 + 7 + 6 = 43 new tests). No existing tests broken.

- [ ] **Step 4: Run typecheck, format check, and full build**

Run: `npm run typecheck && npm run check-format && npm run build`
Expected: PASS. Build should compile cleanly to `build/`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/network/manifest.ts src/tools/network/index.ts
git commit -m "feat(network): register replay tools in manifest and re-export from index"
```

---

## Self-Review

### Spec coverage

- ✅ Section 1 (Architecture & file layout) — Tasks 1-6 create exactly the files listed.
- ✅ Section 2 (`replayEngine.ts`) — Task 2 implements all 5 functions + `STRIPPED_HEADERS` + `emptyReplayResponse`.
- ✅ Section 3 (`replay_network_request`) — Task 3.
- ✅ Section 4 (`export_request_as_curl`) — Task 4, including cookie domain matching.
- ✅ Section 5 (`replay_network_request_batch`) — Task 5, including bounded concurrency, error isolation, statusCodeDistribution.
- ✅ Section 6 (Registration, exports, testing, error handling) — Task 6 + tests in Tasks 2-5.
- ✅ Refinement: `executeReplay` takes `APIRequestContext` directly (noted in plan header).

### Placeholder scan

- No "TBD", "TODO", "implement later", "add error handling" placeholders.
- All test code is concrete; all implementation code is shown.
- No "similar to Task N" — each task is self-contained.

### Type consistency

- `ReplayOverride` — defined Task 1, used Tasks 2-5 (same fields: method, url, headers, body, replaceHeaders).
- `BuiltReplayRequest` — defined Task 1, returned by `buildReplayRequest` (Task 2), passed to `executeReplay` and `formatCurl` (Task 2), used in Tasks 3-5.
- `ReplayResponse` — defined Task 1, returned by `executeReplay` and `emptyReplayResponse` (Task 2), spread into tool response data (Tasks 3, 5).
- `BatchVariantResult` — defined Task 1, produced in Task 5 with fields `index`, `override`, `result`, `error?`.
- `buildReplayRequest` signature consistent across Tasks 2-5: `(original: GetNetworkRequestData, override?: ReplayOverride) => BuiltReplayRequest`.
- `executeReplay` signature consistent across Tasks 2-5: `(apiCtx: APIRequestContext, built: BuiltReplayRequest, maxBodyLength: number) => Promise<ReplayResponse>`.
- `formatCurl` signature consistent Task 2→4: `(built: BuiltReplayRequest, opts: {includeCookies?, cookies?}) => string`.
- `emptyReplayResponse` signature consistent Task 2→3,5: `(url: string) => ReplayResponse`.

No issues found. Plan is ready.
