# BrowserCLI Heavy SPA Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付修订版规范 `docs/superpowers/specs/2026-08-22-browsercli-heavy-page-optimization-design.md` 中 6 个剩余增量的最小可测实现。

**Architecture:** 基于既有 `NetworkModule` / `websocketFormatter` / `HookManager` / `WorkerHttpClient` / browsercli `tool-dispatcher` 之上做增量；全部改动可 `node:test` 单测闭环，不引入新依赖。协议级 CDP `Fetch.enable` 运行时接线与 `analyze_websocket_messages` 的逐帧解码明确划出本计划边界。

**Tech Stack:** TypeScript ESM + `node:test`（`node:assert`）+ swc 构建 + zod schema。browsercli 子包独立 `tsc` 构建。

**Spec:** `docs/superpowers/specs/2026-08-22-browsercli-heavy-page-optimization-design.md`（第 3 节 6 个增量、第 4 节决策 D2/D3/D5，第 5 节验证策略）。

## Global Constraints

- Node `^20.19.0 || ^22.12.0 || >=23`。
- Prettier：`singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`。
- Node 内置模块 import 必须 `node:` 前缀（`node:fs/promises`、`node:buffer` 等）。
- 测试框架 `node:test` + `node:assert`；测试文件镜像源码路径。
- 提交信息 Conventional Commits（`feat:` / `refactor:`）。
- 网络域类型集中在 `src/modules/network/NetworkTypes.ts`；该文件不得 import `worker/` 或 `tools/`（仅 type-only 引用 formatter，沿用现有 `TrafficSummary` 先例）。
- `NetworkModule` 方法签名统一 `(services: NetworkServices, params: P) => Promise<NetworkMethodResult<T>>`。

## 验证命令（全局约定）

- 根项目单文件测试（快速）：`npm run build:dev` 然后 `node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/<path>.test.js`
- 根项目类型检查：`npm run typecheck`
- browsercli 测试：`npm --prefix browsercli run test`
- browsercli 类型检查：`npm --prefix browsercli run typecheck`
- 提交前全量：`npm run test:unit` + `npm run check-format`

---

### Task 1: WorkerHttpClient 409 退避重试

**Files:**
- Modify: `browsercli/src/WorkerHttpClient.ts`（`WorkerHttpClientOptions` 接口 `23-28`、constructor `88-93`、`invoke` `224-261`）
- Test: `browsercli/tests/unit/WorkerHttpClient.test.ts`

**Interfaces:**
- Consumes: `submitInvoke`（`191-206`）、`json()` 对 `!res.ok` 抛 `HTTP 409: <body>`（body 含 `"code":"WORKER_BUSY"`）。
- Produces: `WorkerHttpClientOptions.busyRetryDelaysMs?: number[]`（默认 `[200, 500, 1000]`）；`invoke` 保持原返回签名 `Promise<unknown>`。

- [ ] **Step 1: 写失败测试**

在 `browsercli/tests/unit/WorkerHttpClient.test.ts` 末尾（`describe` 之外）追加：

```typescript
describe('WorkerHttpClient.invoke busy retry', () => {
  it('retries a WORKER_BUSY 409 with backoff then succeeds', async () => {
    let invokePosts = 0;
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url === '/api/v1/sessions') {
        res.statusCode = 201;
        res.end(JSON.stringify({sessionId: 's'}));
        return;
      }
      if (req.method === 'POST' && /\/sessions\/.+\/invoke$/.test(url)) {
        invokePosts += 1;
        if (invokePosts <= 2) {
          res.statusCode = 409;
          res.end(
            JSON.stringify({
              success: false,
              error: {code: 'WORKER_BUSY', message: 'worker is busy'},
            }),
          );
          return;
        }
        res.statusCode = 202;
        res.end(JSON.stringify({jobId: 'job_ok', status: 'pending'}));
        return;
      }
      if (url === '/api/v1/jobs/job_ok') {
        res.end(
          JSON.stringify({jobId: 'job_ok', status: 'done', result: {ok: 1}}),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const client = new WorkerHttpClient({baseUrl, busyRetryDelaysMs: [1, 1]});
    const result = await client.invoke('s', 't', {});
    assert.deepEqual(result, {ok: 1});
    assert.equal(invokePosts, 3);
    await new Promise<void>(r => server.close(() => r()));
  });

  it('gives up after exhausting busy retries', async () => {
    const server = createServer(async (req, res) => {
      const url = (req.url ?? '').split('?')[0];
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url === '/api/v1/sessions') {
        res.statusCode = 201;
        res.end(JSON.stringify({sessionId: 's'}));
        return;
      }
      if (req.method === 'POST' && /\/sessions\/.+\/invoke$/.test(url)) {
        res.statusCode = 409;
        res.end(
          JSON.stringify({
            success: false,
            error: {code: 'WORKER_BUSY', message: 'worker is busy'},
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const client = new WorkerHttpClient({
      baseUrl,
      busyRetryDelaysMs: [1, 1, 1],
    });
    await assert.rejects(() => client.invoke('s', 't', {}), /WORKER_BUSY/);
    await new Promise<void>(r => server.close(() => r()));
  });
});
```

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm --prefix browsercli run test`
Expected: FAIL — 第一个用例 `retries a WORKER_BUSY 409` 报 `HTTP 409`（`invoke` 无退避，直接抛出）；`busyRetryDelaysMs` 尚未被 `WorkerHttpClientOptions` 接受（TS 编译错误）。

- [ ] **Step 3: 最小实现**

在 `browsercli/src/WorkerHttpClient.ts` 做三处修改：

1) `WorkerHttpClientOptions`（`23-28`）加字段：

```typescript
export interface WorkerHttpClientOptions {
  baseUrl: string; // 默认 http://127.0.0.1:8765
  apiToken?: string;
  timeoutMs?: number; // 默认 300000
  pollIntervalMs?: number; // 默认 300
  busyRetryDelaysMs?: number[]; // WORKER_BUSY 退避序列，默认 [200, 500, 1000]
}
```

2) 类字段与 constructor：

```typescript
export class WorkerHttpClient {
  readonly baseUrl: string;
  private readonly apiToken?: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly busyRetryDelaysMs: number[];
  private cachedSessionId?: string;

  constructor(opts: WorkerHttpClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
    this.apiToken = opts.apiToken;
    this.timeoutMs = opts.timeoutMs ?? 300000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 300;
    this.busyRetryDelaysMs = opts.busyRetryDelaysMs ?? [200, 500, 1000];
  }
```

3) `invoke` 内把 `const jobId = await this.submitInvoke(sid, tool, params);` 替换为带重试的方法调用，并新增私有方法（放在 `submitInvoke` 方法之后）：

```typescript
  private async submitInvokeWithBusyRetry(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const delays = this.busyRetryDelaysMs;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.submitInvoke(sessionId, tool, params);
      } catch (err) {
        if (attempt < delays.length && isWorkerBusyError(err)) {
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw err;
      }
    }
  }
```

`invoke` 首段变为：

```typescript
  async invoke(
    sessionId: string | undefined,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const sid = await this.ensureSession(sessionId);
    const jobId = await this.submitInvokeWithBusyRetry(sid, tool, params);
    const deadline = Date.now() + this.timeoutMs;
```

在文件顶部（`STREAM_CHANNELS` 之后、`ToolRecovery` 之前）新增 helper：

```typescript
function isWorkerBusyError(err: unknown): boolean {
  return err instanceof Error && /WORKER_BUSY/.test(err.message);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix browsercli run test`
Expected: PASS — 两个新用例通过；原有 `invoke` 用例不受影响。

- [ ] **Step 5: 提交**

```bash
cd browsercli && git add -A && git commit -m "feat(browsercli): retry WORKER_BUSY 409 with backoff in WorkerHttpClient" && cd ..
```

---

### Task 2: `get_network_request` 截断元数据 + `fullBody`/`saveTo`

**Files:**
- Modify: `src/modules/network/NetworkTypes.ts:195-200`（参数）、`256-283`（返回数据）
- Modify: `src/modules/network/NetworkModule.ts:414-493`（`getRequest`）
- Modify: `src/tools/network/getNetworkRequest.ts`（schema）
- Test: `tests/unit/tools/network/getNetworkRequest.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_GET_BODY_LENGTH = 300`（`NetworkModule.ts:71`）、`isTextualContentType`（`96`，`TEXTUAL_CONTENT_TYPES = ['json','text','javascript']`）。
- Produces: `GetNetworkRequestParams` 增 `fullBody?: boolean`、`saveTo?: string`；`GetNetworkRequestData` 增 `isTruncated: boolean`、`totalBodyLength: number`、`previewLength: number`、`savedPath?: string`。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/tools/network/getNetworkRequest.test.ts`：

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

function createRequest(responseBody: string) {
  return {
    url: () => 'https://example.test/api',
    method: () => 'GET',
    postData: () => null,
    resourceType: () => 'xhr',
    headers: () => ({}),
    response: async () => ({
      status: () => 200,
      statusText: () => 'OK',
      headers: () => ({'content-type': 'application/json'}),
      text: async () => responseBody,
    }),
  };
}

function createServices(body: string): NetworkServices {
  const request = createRequest(body);
  return {
    resolvePage: selector => {
      throw new Error('unused');
    },
    getPages: () => [],
    getSelectedPage: () => null,
    getNetworkRequests: () => [],
    getNetworkRequestsForPage: () => [],
    getNetworkRequestById: () => request as never,
    getNetworkRequestStableId: () => 101,
    getRequestInitiator: () => undefined,
    clearNetworkRequests: () => {},
    clearNetworkRequestsForPage: () => undefined,
    getWebSocketConnections: () => [],
    getWebSocketConnectionById: () => ({connection: {}, frames: []}) as never,
    getWebSocketStableId: () => 0,
    getDevToolsData: async () => undefined,
    resolveCdpRequestId: () => undefined,
  } as NetworkServices;
}

describe('getNetworkRequest body handling', () => {
  const networkModule = new NetworkModule();
  const tmpDirPath = mkdtemp(path.join(tmpdir(), 'getNetworkRequest-'));

  after(async () => {
    await rm(tmpDirPath, {recursive: true, force: true});
  });

  it('truncates large bodies by default and reports metadata', async () => {
    const services = createServices('x'.repeat(5000));
    const result = await networkModule.getRequest(services, {reqid: 101});
    assert.equal(result.success, true);
    assert.equal(result.data.isTruncated, true);
    assert.equal(result.data.totalBodyLength, 5000);
    assert.ok(result.data.responseBody!.length < 5000);
    assert.equal(result.data.previewLength, result.data.responseBody!.length);
  });

  it('returns the full body when fullBody is set', async () => {
    const services = createServices('x'.repeat(5000));
    const result = await networkModule.getRequest(services, {
      reqid: 101,
      fullBody: true,
    });
    assert.equal(result.data.isTruncated, false);
    assert.equal(result.data.responseBody!.length, 5000);
  });

  it('writes body to disk when saveTo is set', async () => {
    const body = '{"a":1}';
    const services = createServices(body);
    const target = path.join(tmpDirPath, 'out.json');
    const result = await networkModule.getRequest(services, {
      reqid: 101,
      saveTo: target,
    });
    assert.equal(result.data.savedPath, target);
    assert.equal(result.data.responseBody, undefined);
    assert.equal(await readFile(target, 'utf8'), body);
  });
});
```

> 说明：`before` 未使用可省略 import（上面已不导入 `before`，请保持一致）。`mkdtemp` 返回 Promise，`tmpDirPath` 是 Promise<string>；`path.join` 需 `await`。修正为：`const tmpDir = await mkdtemp(...)` 放 `before` 钩子中。见 Step 3 之后的提示。

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/network/getNetworkRequest.test.js`
Expected: FAIL — 断言失败：`result.data.isTruncated` 为 `undefined`（字段尚未存在）；TS 编译报 `isTruncated`/`totalBodyLength`/`fullBody`/`saveTo` 不存在。

- [ ] **Step 3: 修正测试样板，再写实现**

先修正测试的临时目录处理（把 `mkdtemp` 移入 `before`）：

```typescript
describe('getNetworkRequest body handling', () => {
  const networkModule = new NetworkModule();
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'getNetworkRequest-'));
  });

  after(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('truncates large bodies by default and reports metadata', async () => {
    /* ... 同上，saveTo 用例的 target 改为 path.join(tmpDir, 'out.json') ... */
  });
  // ... saveTo 用例内改 target = path.join(tmpDir, 'out.json')
});
```

然后改 `src/modules/network/NetworkTypes.ts`：

`GetNetworkRequestParams`（`195-200`）追加：

```typescript
  /** 返回完整响应体（跳过默认截断） */
  fullBody?: boolean;
  /** 将响应体写入指定文件路径，返回 savedPath，不写入响应内存 */
  saveTo?: string;
```

`GetNetworkRequestData`（`256-283`）在 `responseBody?: string;` 之后追加：

```typescript
  /** 响应体是否被截断 */
  isTruncated: boolean;
  /** 完整响应体长度（字符） */
  totalBodyLength: number;
  /** 实际返回的预览长度 */
  previewLength: number;
  /** saveTo 时写入的文件路径 */
  savedPath?: string;
```

- [ ] **Step 4: 实现 `NetworkModule.getRequest`**

在 `src/modules/network/NetworkModule.ts` 顶部 import 区加：

```typescript
import {writeFile} from 'node:fs/promises';
```

`EMPTY`（`418-426`）追加新字段：

```typescript
    const EMPTY = {
      reqid: 0,
      url: '',
      method: '',
      resourceType: '',
      statusCode: 0,
      requestHeaders: {},
      responseHeaders: {},
      isTruncated: false,
      totalBodyLength: 0,
      previewLength: 0,
    } as const;
```

替换 `448-463` 的 `maxBodyLength`/`responseBody` 块为：

```typescript
      const maxBodyLength = params.maxBodyLength ?? DEFAULT_GET_BODY_LENGTH;
      let responseBody: string | undefined;
      let fullBody: string | undefined;
      let isTruncated = false;
      let totalBodyLength = 0;
      let savedPath: string | undefined;
      if (httpResponse) {
        try {
          const contentType = httpResponse.headers()['content-type'] ?? '';
          if (isTextualContentType(contentType)) {
            fullBody = await httpResponse.text();
            totalBodyLength = fullBody.length;
            if (params.saveTo) {
              await writeFile(params.saveTo, fullBody, 'utf-8');
              savedPath = params.saveTo;
            } else if (params.fullBody) {
              responseBody = fullBody;
            } else if (fullBody.length > maxBodyLength) {
              isTruncated = true;
              responseBody =
                fullBody.slice(0, maxBodyLength) + '\n... [truncated]';
            } else {
              responseBody = fullBody;
            }
          }
        } catch {
          // 忽略读取失败
        }
      }
```

在 `data`（`467-479`）对象末尾（`responseBody,` 之后）追加：

```typescript
        isTruncated,
        totalBodyLength,
        previewLength: responseBody?.length ?? 0,
        ...(savedPath !== undefined && {savedPath}),
```

- [ ] **Step 5: 扩展工具 schema**

在 `src/tools/network/getNetworkRequest.ts` 的 schema 里、`maxBodyLength` 之后追加：

```typescript
    fullBody: zod
      .boolean()
      .optional()
      .describe('返回完整响应体，跳过默认截断。'),
    saveTo: zod
      .string()
      .optional()
      .describe('将响应体保存到指定文件路径，返回 savedPath，不占用响应内存。'),
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/network/getNetworkRequest.test.js`
Expected: PASS — 3 个用例通过。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat(network): add truncation metadata and fullBody/saveTo to get_network_request"
```

---

### Task 3: `decodeWsPayload` 零 schema 解码纯函数

**Files:**
- Modify: `src/formatters/websocketFormatter.ts`
- Test: `tests/unit/formatters/websocketFormatter.test.ts`

**Interfaces:**
- Consumes: `WebSocketFrame.payloadData: string`（binary 帧为 base64）、`opcode: number`（2=binary）。
- Produces: `export type WsDecodeMode = 'auto' | 'protobuf' | 'json' | 'raw'`；`export interface WsDecodeResult { decodeType: 'json' | 'protobuf-embedded-json' | 'protobuf' | 'text' | 'raw'; decodedJson?: unknown }`；`export function decodeWsPayload(payload: string, opcode: number, mode?: WsDecodeMode): WsDecodeResult`。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/formatters/websocketFormatter.test.ts`：

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {Buffer} from 'node:buffer';
import {describe, it} from 'node:test';

import {decodeWsPayload} from '../../../src/formatters/websocketFormatter.js';

function protobufEmbeddedJson(json: string): string {
  const jsonBytes = new TextEncoder().encode(json);
  const bytes = new Uint8Array([0x0a, jsonBytes.length, ...jsonBytes]);
  return Buffer.from(bytes).toString('base64');
}

describe('decodeWsPayload', () => {
  it('extracts embedded JSON from a protobuf binary frame', () => {
    const payload = protobufEmbeddedJson('{"a":1}');
    const result = decodeWsPayload(payload, 2, 'auto');
    assert.equal(result.decodeType, 'protobuf-embedded-json');
    assert.deepEqual(result.decodedJson, {a: 1});
  });

  it('parses a plain text JSON frame', () => {
    const result = decodeWsPayload('{"ping":true}', 1, 'auto');
    assert.equal(result.decodeType, 'json');
    assert.deepEqual(result.decodedJson, {ping: true});
  });

  it('labels non-json text as text', () => {
    const result = decodeWsPayload('hello', 1, 'auto');
    assert.equal(result.decodeType, 'text');
    assert.equal(result.decodedJson, undefined);
  });

  it('returns raw without decoding when mode is raw', () => {
    const result = decodeWsPayload('anything', 2, 'raw');
    assert.equal(result.decodeType, 'raw');
  });
});
```

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/formatters/websocketFormatter.test.js`
Expected: FAIL — `decodeWsPayload` 未导出（`undefined is not a function`）。

- [ ] **Step 3: 实现纯函数**

在 `src/formatters/websocketFormatter.ts` 文件末尾（`formatTrafficSummary` 等之后）追加：

```typescript
// ============================================================================
// Zero-schema payload decoding
// ============================================================================

export type WsDecodeMode = 'auto' | 'protobuf' | 'json' | 'raw';

export interface WsDecodeResult {
  decodeType: 'json' | 'protobuf-embedded-json' | 'protobuf' | 'text' | 'raw';
  decodedJson?: unknown;
}

function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function findJsonEnd(s: string): number {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      const open = stack.pop();
      if ((c === '}' && open !== '{') || (c === ']' && open !== '[')) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

function extractEmbeddedJson(bytes: Uint8Array): unknown {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x7b && bytes[i] !== 0x5b) continue;
    const tail = bytesToUtf8(bytes.subarray(i));
    const end = findJsonEnd(tail);
    if (end < 0) continue;
    try {
      return JSON.parse(tail.slice(0, end));
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * 对单条 WebSocket 帧负载做启发式解码：
 * - 文本帧：尝试 JSON.parse，失败标记 text。
 * - 二进制帧（base64）：扫描嵌入的 JSON 对象/数组边界，命中即标记
 *   `protobuf-embedded-json`；否则标记 `protobuf`。
 */
export function decodeWsPayload(
  payload: string,
  opcode: number,
  mode: WsDecodeMode = 'auto',
): WsDecodeResult {
  if (mode === 'raw') return {decodeType: 'raw'};
  if (opcode === 1) {
    if (mode === 'protobuf') return {decodeType: 'protobuf'};
    try {
      return {decodeType: 'json', decodedJson: JSON.parse(payload)};
    } catch {
      return {decodeType: 'text'};
    }
  }
  if (opcode === 2) {
    const bytes = base64ToBytes(payload);
    if (!bytes) return {decodeType: 'protobuf'};
    const embedded = extractEmbeddedJson(bytes);
    if (embedded !== undefined) {
      return {decodeType: 'protobuf-embedded-json', decodedJson: embedded};
    }
    return {decodeType: 'protobuf'};
  }
  return {decodeType: 'text'};
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/formatters/websocketFormatter.test.js`
Expected: PASS — 4 个用例通过。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(websocket): add zero-schema protobuf/json payload decoder"
```

---

### Task 4: `get_websocket_message` 接入 `decode`

**Files:**
- Modify: `src/modules/network/NetworkTypes.ts:305-309`（参数）、`433-446`（返回数据）
- Modify: `src/modules/network/NetworkModule.ts:1009-1055`（`getWebSocketMessage`）
- Modify: `src/tools/network/getMessage.ts`（schema）
- Test: `tests/unit/tools/network/getMessage.test.ts`

**Interfaces:**
- Consumes: `decodeWsPayload`（Task 3）、`GetWebSocketMessageParams`、`GetWebSocketMessageData.frame`。
- Produces: `GetWebSocketMessageParams.decode?: WsDecodeMode`；`GetWebSocketMessageData.frame` 增 `decodeType?: string`、`decodedJson?: unknown`。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/tools/network/getMessage.test.ts`：

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {Buffer} from 'node:buffer';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

function binaryFrame(payload: string) {
  return {
    direction: 'received',
    timestamp: Date.now(),
    opcode: 2,
    payloadData: payload,
  };
}

describe('getWebSocketMessage decoding', () => {
  const networkModule = new NetworkModule();

  function servicesWith(frame: unknown): NetworkServices {
    return {
      getWebSocketConnectionById: () => ({
        connection: {url: 'wss://x', status: 'open'},
        frames: [frame],
      }),
    } as unknown as NetworkServices;
  }

  it('includes decodeType and decodedJson when decode is auto', () => {
    const json = '{"op":"login"}';
    const jsonBytes = new TextEncoder().encode(json);
    const bytes = new Uint8Array([0x0a, jsonBytes.length, ...jsonBytes]);
    const payload = Buffer.from(bytes).toString('base64');
    const result = networkModule.getWebSocketMessage(
      servicesWith(binaryFrame(payload)),
      {wsid: 1, frameIndex: 0, decode: 'auto'},
    );
    assert.equal(result.success, true);
    assert.equal(result.data.frame?.decodeType, 'protobuf-embedded-json');
    assert.deepEqual(result.data.frame?.decodedJson, {op: 'login'});
  });
});
```

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/network/getMessage.test.js`
Expected: FAIL — `result.data.frame.decodeType` 为 `undefined`；`decode` 参数类型报错。

- [ ] **Step 3: 扩展类型**

`src/modules/network/NetworkTypes.ts`：

1) 顶部 formatter type import 合并 `WsDecodeMode`：
```typescript
import type {
  TrafficSummary,
  WsDecodeMode,
} from '../../formatters/websocketFormatter.js';
```

2) `GetWebSocketMessageParams`（`305-309`）：
```typescript
export interface GetWebSocketMessageParams {
  wsid: number;
  frameIndex: number;
  decode?: WsDecodeMode;
}
```

3) `GetWebSocketMessageData.frame`（`438-445`）在 `payloadPreview` 之后追加：
```typescript
    decodeType?: string;
    decodedJson?: unknown;
```

- [ ] **Step 4: 实现接入**

`src/modules/network/NetworkModule.ts`：

1) import `decodeWsPayload`（在既有 `analyzeWebSocketFramesV2` import 之后追加）：
```typescript
import {
  analyzeWebSocketFramesV2,
  decodeWsPayload,
  formatGroupMessages,
  formatRecentMessages,
  formatTrafficSummary,
  formatWebSocketFrameDetail,
  type TrafficSummary,
} from '../../formatters/websocketFormatter.js';
```

2) `getWebSocketMessage`（`1009-1055`）在 `const frame = ws.frames[frameIndex];` 之后、`const lines = ...` 之前插入：
```typescript
      const decoded = decodeWsPayload(
        frame.payloadData,
        frame.opcode,
        params.decode ?? 'auto',
      );
```

并把返回 data 的 `frame` 对象（`1038-1045`）追加 `decodeType`/`decodedJson`：
```typescript
          frame: {
            direction: frame.direction,
            timestamp: frame.timestamp,
            timestampISO: new Date(frame.timestamp).toISOString(),
            opcode: frame.opcode,
            payloadSize: frame.payloadData.length,
            payloadPreview: frame.payloadData.slice(0, 500),
            decodeType: decoded.decodeType,
            ...(decoded.decodedJson !== undefined && {
              decodedJson: decoded.decodedJson,
            }),
          },
```

- [ ] **Step 5: 扩展工具 schema**

`src/tools/network/getMessage.ts` 在 `frameIndex` 之后追加：
```typescript
    decode: zod
      .enum(['auto', 'protobuf', 'json', 'raw'])
      .optional()
      .describe(
        '解码模式：auto 自动识别，protobuf 按 protobuf 解析，json 提取 JSON，raw 原样。',
      ),
```
并把 handler 里传给 `getWebSocketMessage` 的 `params` 补上 `decode`：
```typescript
    const result = getRuntime().networkModule.getWebSocketMessage(
      getRuntime().contextProvider!,
      {
        wsid: request.params.wsid,
        frameIndex: request.params.frameIndex,
        decode: (request.params as Record<string, unknown>).decode as
          | 'auto'
          | 'protobuf'
          | 'json'
          | 'raw'
          | undefined,
      } as GetWebSocketMessageParams,
    );
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/network/getMessage.test.js`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat(websocket): wire decode param into get_websocket_message"
```

---

### Task 5: `create_hook` `protocolFallback` 透传

**Files:**
- Modify: `src/modules/hook/HookManager.ts:28-72`（`HookCreateOptions`）、`143-193`（`create` 返回）
- Modify: `src/tools/hook/CreateHook.ts`（schema）
- Test: `tests/unit/modules/hook/HookManager.test.ts`

> 边界说明：本任务仅落地数据层——`protocolFallback` 标志由 `create_hook` 传入、随 `create()` 返回值透传并在 HookMeta.config 中留存。CDP `Fetch.enable` 的运行时启用接线依赖浏览器/CDP 会话生命周期，需要集成环境，属后续独立计划（非本计划占位，占位无效）。

**Interfaces:**
- Consumes: `HookCreateOptions`（`HookManager.ts:28`）、`HookManager.create() => {hookId, script}`（`143`）。
- Produces: `HookCreateOptions.protocolFallback?: boolean`；`create()` 返回增 `protocolFallback?: boolean`。

- [ ] **Step 1: 写失败测试**

在 `tests/unit/modules/hook/HookManager.test.ts` 追加：

```typescript
  it('transparently carries protocolFallback through create()', () => {
    const result = manager.create({type: 'fetch', protocolFallback: true});
    assert.equal(result.protocolFallback, true);
  });

  it('omits protocolFallback when not provided', () => {
    const result = manager.create({type: 'fetch'});
    assert.equal(result.protocolFallback, undefined);
  });
```

> 注：`manager` 的构造方式以该测试文件现有基准为准（若无共享实例，则在本 describe 内 `const manager = new HookManager();`）。请先阅读该文件确认现有 `HookManager` 实例命名。

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/hook/HookManager.test.js`
Expected: FAIL — `result.protocolFallback` 为 `undefined`；`protocolFallback` 属性在 `HookCreateOptions` 上不存在（TS 报错）。

- [ ] **Step 3: 实现**

1) `src/modules/hook/HookManager.ts` 的 `HookCreateOptions`（`28-72`）在 `asyncAware` 之后追加：
```typescript
  /** opt-in 协议级回退：为 true 时由注入方启用 CDP Fetch 域拦截 */
  protocolFallback?: boolean;
```

2) `create()` 返回语句（`192`）改为：
```typescript
    return {hookId, script, protocolFallback: options.protocolFallback};
```

3) `src/tools/hook/CreateHook.ts` 的 schema、`condition` 之后追加：
```typescript
    protocolFallback: zod
      .boolean()
      .optional()
      .describe(
        'opt-in 协议级拦截：为 true 时由注入方启用 CDP Fetch.enable 回退（默认 false）。',
      ),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/hook/HookManager.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(hook): carry protocolFallback flag through create_hook"
```

---

### Task 6: `direction` 增加 `'both'`

**Files:**
- Modify: `src/modules/network/NetworkTypes.ts:296-303`、`311-315`
- Modify: `src/modules/network/NetworkModule.ts:892-1004`、`1100-1102`
- Modify: `src/tools/network/getMessages.ts:14`
- Modify: `src/tools/network/analyzeMessages.ts:14`
- Test: `tests/unit/tools/network/getMessages.direction.test.ts`

**Interfaces:**
- Consumes: `GetWebSocketMessagesParams.direction`、`AnalyzeWebSocketMessagesParams.direction`。
- Produces: 两参数 `direction` 类型扩为 `'sent' | 'received' | 'both'`（可选，默认不改）。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/tools/network/getMessages.direction.test.ts`：

```typescript
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

function frame(direction: 'sent' | 'received') {
  return {
    direction,
    timestamp: Date.now(),
    opcode: 1,
    payloadData: '{}',
  };
}

function services(): NetworkServices {
  return {
    getWebSocketConnectionById: () => ({
      connection: {url: 'wss://x', status: 'open'},
      frames: [frame('sent'), frame('received'), frame('sent')],
    }),
  } as unknown as NetworkServices;
}

describe('getWebSocketMessages direction both', () => {
  const networkModule = new NetworkModule();

  it('returns all frames when direction is both', async () => {
    const result = await networkModule.getWebSocketMessages(services(), {
      wsid: 1,
      direction: 'both',
      pageSize: 10,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.pagination?.total, 3);
  });

  it('filters to sent when direction is sent', async () => {
    const result = await networkModule.getWebSocketMessages(services(), {
      wsid: 1,
      direction: 'sent',
      pageSize: 10,
    });
    assert.equal(result.data.pagination?.total, 2);
  });
});
```

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/network/getMessages.direction.test.js`
Expected: FAIL — `'both'` 不被类型接受（TS 报错）；即便运行时，`direction: 'both'` 会落入 `.filter(f => f.direction === 'both')` 导致 total 为 0。

- [ ] **Step 3: 实现**

1) `src/modules/network/NetworkTypes.ts`：

`GetWebSocketMessagesParams`（`296-303`）的 `direction`：
```typescript
  direction?: 'sent' | 'received' | 'both';
```
`AnalyzeWebSocketMessagesParams`（`311-315`）的 `direction`：
```typescript
  direction?: 'sent' | 'received' | 'both';
```

2) `src/modules/network/NetworkModule.ts` 的 `getWebSocketMessages`：

`900-902` 改为：
```typescript
      if (params.direction && params.direction !== 'both') {
        frames = frames.filter(f => f.direction === params.direction);
      }
```

`933-939`（groupId 内）改为：
```typescript
        let filteredIndices = indices;
        if (params.direction && params.direction !== 'both') {
          filteredIndices = indices.filter(idx => {
            const frame = ws.frames[idx];
            return frame && frame.direction === params.direction;
          });
        }
```

`analyzeWebSocketMessages` 的 `1100-1102` 改为：
```typescript
      if (params.direction && params.direction !== 'both') {
        groups = groups.filter(g => g.direction === params.direction);
      }
```

3) `src/tools/network/getMessages.ts:14`：
```typescript
const DIRECTION_OPTIONS: readonly ['sent', 'received', 'both'] = [
  'sent',
  'received',
  'both',
];
```
并把 `direction` 的 describe 追加一句：`'both'（合并发送与接收，缺省等价于不过滤）`。

4) `src/tools/network/analyzeMessages.ts:14` 同样改为：
```typescript
const DIRECTION_OPTIONS: readonly ['sent', 'received', 'both'] = [
  'sent',
  'received',
  'both',
];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build:dev && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/network/getMessages.direction.test.js`
Expected: PASS — 两个用例通过。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(websocket): support direction=both in websocket message tools"
```

---

### Task 7: browsercli `call --json` 纯数据输出

**Files:**
- Modify: `browsercli/src/commands/shared/tool-args.ts:13-19`（`TOOL_CONTROL_FLAGS`）
- Modify: `browsercli/src/commands/tool-dispatcher.ts`（读 `json` flag + 输出分支）
- Test: `browsercli/tests/unit/tool-dispatcher.test.ts`

**Interfaces:**
- Consumes: `getBoolFlag`（`tool-dispatcher.ts:12` 已 import）、`successOutput`、`TOOL_CONTROL_FLAGS`。
- Produces: `call --json` 直接返回工具的 `result`（纯数据，无 `command/target/tool` 包装），且 `json` 不作为工具参数下发。

- [ ] **Step 1: 写失败测试**

在 `browsercli/tests/unit/tool-dispatcher.test.ts` 的 `describe('tool-dispatcher (pure HTTP)')` 内追加：

```typescript
  it('emits raw tool result when --json is set', async () => {
    const client = new MockHttpClient(SAMPLE_TOOLS, {hello: 'world'});
    const result = await toolDispatcherCommand(
      ['my_tool', '--json'],
      ctxWith(client),
    );
    assert.deepStrictEqual(result, {hello: 'world'});
  });

  it('does not send --json as a tool param', async () => {
    const client = new MockHttpClient(SAMPLE_TOOLS, {done: true});
    await toolDispatcherCommand(['my_tool', '--json'], ctxWith(client));
    assert.deepStrictEqual(client.invokeCalls[0][2], {});
  });
```

- [ ] **Step 2: 运行测试确认为失败**

Run: `npm --prefix browsercli run test`
Expected: FAIL — 第一个用例：返回仍是 `{status, command, target, tool, result}` 而非 `{hello:'world'}`；第二个用例：`invokeCalls[0][2]` 为 `{json: true}`（`json` 未被当作控制 flag 排除）。

- [ ] **Step 3: 实现**

1) `browsercli/src/commands/shared/tool-args.ts:13-19` 的 `TOOL_CONTROL_FLAGS` 追加 `json`：

```typescript
export const TOOL_CONTROL_FLAGS: ReadonlySet<string> = new Set([
  'file',
  'data',
  'stdin',
  'session',
  'watch',
  'json',
]);
```

2) `browsercli/src/commands/tool-dispatcher.ts` 在 `try` 块末尾（`return successOutput({...})`，即 `199-211` 处）改为：

```typescript
    const failure = extractToolFailure(result);
    if (failure) {
      throw new AxiError(`工具执行失败：${failure}`, 'TOOL_FAILURE');
    }

    if (getBoolFlag(parsed, 'json')) {
      return result as Record<string, unknown>;
    }

    return successOutput({
      command: 'call',
      target: requestedName,
      tool: candidate.name,
      result,
    });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix browsercli run test`
Expected: PASS — 两个新用例通过；既有 `tool-dispatcher` 用例不受影响。

- [ ] **Step 5: 提交**

```bash
cd browsercli && git add -A && git commit -m "feat(browsercli): emit raw JSON from call --json" && cd ..
```

---

## Self-Review Checklist（已核对）

1. **Spec 覆盖**：规范 §3 六增量 → Task 1/2/3+4/5/6/7 全命中。§3 增量 3 的 `analyze_websocket_messages` 逐帧解码、§3 增量 4 的 CDP `Fetch.enable` 运行时接线按决策 D2/D4 明确划为边界（见 Task 4/5 边界说明），非遗漏。
2. **Placeholder 扫描**：无 `TBD`/`TODO`/“类似 Task N”；测试与实现代码均给出真实内容。
3. **类型一致性**：`WsDecodeMode`（Task 3 定义 → Task 4 引用）、`busyRetryDelaysMs`（Task 1 定义→使用）、`protocolFallback`（Task 5 定义→透传）、`direction: 'both'`（Task 6 定义→三处消费）均前后一致；`GetNetworkRequestData` 的 `isTruncated/totalBodyLength/previewLength` 必填字段在 `EMPTY` 与 `data` 路径同步补齐。

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-08-22-browsercli-heavy-page-optimization.md`。

**两种执行方式：**

1. **Subagent-Driven（推荐）** - 每个 task 派发独立 subagent，task 间评审，快速迭代
2. **Inline Execution** - 当前会话内用 executing-plans 逐 task 执行，checkpoint 评审

请选哪种？