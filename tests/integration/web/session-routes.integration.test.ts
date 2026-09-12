/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {beforeEach, describe, it} from 'node:test';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
import type {CapturedRequestInput} from '../../../src/modules/session/types.js';
import type {LLMService} from '../../../src/services/LLMService.js';
import {RestRouter} from '../../../src/web/RestRouter.js';
import {createSessionRoutes} from '../../../src/web/routes/session.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  setHeader(name: string, value: string): void;
  end(payload?: string): void;
  headersSent: boolean;
}

// 注意：必须是 IncomingMessage。RestRouter.dispatch(req, res, pathname) 的
// 第一参是 IncomingMessage（RestRouter.ts:63-67），纯 EventEmitter 会 TS2345。
// 用 `as unknown as` 在**函数内部**完成断言（与 tests/unit/web/routes/proxy.test.ts:34
// 同款），调用点就不必再写 `as never`。
function mockReq(method: string, url: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  req.method = method;
  req.url = url;
  process.nextTick(() => req.emit('end'));
  return req;
}

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(payload?: string) {
      this.headersSent = true;
      this.body = payload ? JSON.parse(payload) : undefined;
    },
  };
  return res as MockRes;
}

const OFFLINE_LLM = {
  isConfigured: () => false,
} as unknown as LLMService;

function input(
  overrides: Partial<CapturedRequestInput> = {},
): CapturedRequestInput {
  return {
    timestamp: 1_700_000_000_000,
    method: 'GET',
    url: 'https://d.dev/api/x',
    source: 'cdp',
    requestHeaders: '{"cookie":"session=1"}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: '{"content-type":"application/json"}',
    responseBody: '{"secret":"value"}',
    contentType: 'application/json',
    initiator: null,
    durationMs: 0,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
    ...overrides,
  };
}

describe('createSessionRoutes', () => {
  let router: RestRouter;
  let manager: CaptureSessionManager;
  let store: SqliteSessionStore;
  let db: DatabaseManager;

  beforeEach(() => {
    db = new DatabaseManager(':memory:');
    store = new SqliteSessionStore(db);
    manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);
    engine.ingestRequest(input());
    engine.ingestRequest(input({url: 'https://d.dev/api/y', method: 'POST'}));
    engine.ingestRequest(
      input({
        source: 'proxy',
        url: 'https://d.dev/api/z',
        responseHeaders: '{not-json',
      }),
    );
    router = new RestRouter();
    router.mount(
      createSessionRoutes(() => ({
        manager,
        store,
        llmService: OFFLINE_LLM,
      })),
    );
  });

  it('returns summaries without any body field', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as {
      success: boolean;
      data: {items: unknown[]; total: number};
    };
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.total, 3);
    assert.strictEqual(body.data.items.length, 3);
    for (const item of body.data.items as Array<Record<string, unknown>>) {
      assert.strictEqual(
        'responseBody' in item,
        false,
        'spec §8 / R1：摘要不含 body',
      );
      assert.strictEqual('requestHeaders' in item, false);
    }
    // spec §9：SQL 按 sequence DESC 取，响应内反转成时间正序。
    // 此处 limit 缺省（500）>= total（3），所以整窗返回、items[0] 确实最旧。
    // 带 limit 时 items[0] 是窗口内最新（见 Step 3 「反转」注释）。
    const urls = (body.data.items as Array<{url: string}>).map(i => i.url);
    assert.deepStrictEqual(urls, [
      'https://d.dev/api/x',
      'https://d.dev/api/y',
      'https://d.dev/api/z',
    ]);
  });

  it('filters by sources', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?sources=proxy'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    const body = res.body as {
      data: {items: Array<{source: string}>; total: number};
    };
    assert.strictEqual(body.data.total, 1);
    assert.strictEqual(body.data.items[0]!.source, 'proxy');
  });

  it('filters by flow filter expression', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?filter=~m%20POST'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    const body = res.body as {
      data: {items: Array<{method: string; url: string}>; total: number};
    };
    assert.strictEqual(body.data.total, 1);
    assert.strictEqual(body.data.items[0]?.method, 'POST');
    assert.strictEqual(body.data.items[0]?.url, 'https://d.dev/api/y');
  });

  it('clamps limit and offset without 500', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?limit=99999&offset=-5'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as {data: {items: unknown[]}};
    assert.strictEqual(body.data.items.length, 3);
  });

  it('returns 400 for a non-numeric limit', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?limit=abc'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 400);
  });

  it('returns the detail with headers as objects', async () => {
    // 注意：SQL 先 DESC 再 LIMIT，limit=1 取到的是 cdp 里**最新**的一条 = api/y
    //（不是最旧的 api/x）。显式断言 url，把这个隐含假设钉死——否则三条 fixture
    // 的 body 恰好相同时，取错行也能蒙混过关。
    const listRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?sources=cdp&limit=1'),
      listRes as unknown as ServerResponse,
      '/api/session/requests',
    );
    const {items} = (
      listRes.body as {
        data: {items: Array<{id: string; url: string}>};
      }
    ).data;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]!.url, 'https://d.dev/api/y', 'DESC + LIMIT 1');
    const id = items[0]!.id;

    const res = mockRes();
    await router.dispatch(
      mockReq('GET', `/api/session/requests/${id}`),
      res as unknown as ServerResponse,
      `/api/session/requests/${id}`,
    );

    assert.strictEqual(res.statusCode, 200);
    const detail = (res.body as {data: Record<string, unknown>}).data;
    assert.strictEqual(detail['responseBody'], '{"secret":"value"}');
    assert.deepStrictEqual(detail['responseHeaders'], {
      'content-type': 'application/json',
    });
    assert.strictEqual(detail['headersParseError'], undefined);
  });

  it('degrades dirty header JSON to {} with headersParseError', async () => {
    const listRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests?sources=proxy'),
      listRes as unknown as ServerResponse,
      '/api/session/requests',
    );
    const {items} = (
      listRes.body as {
        data: {items: Array<{id: string; url: string}>};
      }
    ).data;
    assert.strictEqual(items[0]!.url, 'https://d.dev/api/z');

    const res = mockRes();
    await router.dispatch(
      mockReq('GET', `/api/session/requests/${items[0]!.id}`),
      res as unknown as ServerResponse,
      `/api/session/requests/${items[0]!.id}`,
    );

    assert.strictEqual(res.statusCode, 200);
    const detail = (res.body as {data: Record<string, unknown>}).data;
    assert.deepStrictEqual(detail['responseHeaders'], {});
    assert.strictEqual(detail['headersParseError'], true);
  });

  it('returns 404 for an unknown id', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests/does-not-exist'),
      res as unknown as ServerResponse,
      '/api/session/requests/does-not-exist',
    );

    assert.strictEqual(res.statusCode, 404);
  });

  it('clears all requests of the active session', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('DELETE', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 200);
    const body = res.body as {data: {clearedCount: number}};
    assert.strictEqual(body.data.clearedCount, 3);

    const listRes = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/session/requests'),
      listRes as unknown as ServerResponse,
      '/api/session/requests',
    );
    const listBody = listRes.body as {data: {items: unknown[]; total: number}};
    assert.strictEqual(listBody.data.total, 0);
    assert.strictEqual(listBody.data.items.length, 0);
  });

  it('returns 503 when clearing without an active session', async () => {
    const freshDb = new DatabaseManager(':memory:');
    const freshStore = new SqliteSessionStore(freshDb);
    const bare = new RestRouter();
    bare.mount(
      createSessionRoutes(() => ({
        manager: new CaptureSessionManager(freshStore),
        store: freshStore,
        llmService: OFFLINE_LLM,
      })),
    );

    const res = mockRes();
    await bare.dispatch(
      mockReq('DELETE', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 503);
    freshDb.close();
  });

  it('returns 503 when session services are unavailable', async () => {
    const bare = new RestRouter();
    bare.mount(createSessionRoutes(() => undefined));
    const res = mockRes();
    await bare.dispatch(
      mockReq('GET', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(res.statusCode, 503);
    const body = res.body as {error: {code: string}};
    assert.strictEqual(body.error.code, 'SESSION_UNAVAILABLE');
  });

  it('returns 503 with no active session instead of throwing', async () => {
    const freshDb = new DatabaseManager(':memory:');
    const freshStore = new SqliteSessionStore(freshDb);
    const bare = new RestRouter();
    bare.mount(
      createSessionRoutes(() => ({
        manager: new CaptureSessionManager(freshStore),
        store: freshStore,
        llmService: OFFLINE_LLM,
      })),
    );

    const res = mockRes();
    await bare.dispatch(
      mockReq('GET', '/api/session/requests'),
      res as unknown as ServerResponse,
      '/api/session/requests',
    );

    assert.strictEqual(
      res.statusCode,
      503,
      'spec §13-D7：查询不得创建会话；无活动会话是 503 不是 500',
    );
    freshDb.close();
  });

  describe('POST /api/session/analyze', () => {
    // 自己构造：mockReq 会先排一次 'end'，POST 必须只发一次 end（先 data 后 end）。
    function mockPost(bodyObj?: unknown): IncomingMessage {
      const req = new EventEmitter() as unknown as IncomingMessage & {
        method: string;
        url: string;
      };
      req.method = 'POST';
      req.url = '/api/session/analyze';
      process.nextTick(() => {
        req.emit('data', Buffer.from(JSON.stringify(bodyObj ?? {})));
        req.emit('end');
      });
      return req;
    }

    it('analyzes the selected request ids and returns a report', async () => {
      const listRes = mockRes();
      await router.dispatch(
        mockReq('GET', '/api/session/requests'),
        listRes as unknown as ServerResponse,
        '/api/session/requests',
      );
      const {items} = (
        listRes.body as {data: {items: Array<{id: string; url: string}>}}
      ).data;
      const target = items.find(i => i.url === 'https://d.dev/api/y')!;

      const res = mockRes();
      await router.dispatch(
        mockPost({requestIds: [target.id], mode: 'api_reverse'}),
        res as unknown as ServerResponse,
        '/api/session/analyze',
      );

      assert.strictEqual(res.statusCode, 200);
      const data = (res.body as {data: Record<string, unknown>}).data;
      assert.strictEqual(data['requestCount'], 1);
      assert.strictEqual(data['mode'], 'api_reverse');
      assert.strictEqual(data['llmUsed'], false);
      assert.ok(String(data['reportMarkdown']).includes('https://d.dev/api/y'));
      assert.ok(data['reportId'], '路由默认持久化报告');
    });

    it('analyzes the whole session when requestIds is omitted', async () => {
      const res = mockRes();
      await router.dispatch(
        mockPost({}),
        res as unknown as ServerResponse,
        '/api/session/analyze',
      );

      assert.strictEqual(res.statusCode, 200);
      const data = (res.body as {data: Record<string, unknown>}).data;
      assert.strictEqual(data['requestCount'], 3);
    });

    it('returns 400 for a non-JSON body', async () => {
      const req = new EventEmitter() as unknown as IncomingMessage & {
        method: string;
        url: string;
      };
      req.method = 'POST';
      req.url = '/api/session/analyze';
      process.nextTick(() => {
        req.emit('data', Buffer.from('not-json'));
        req.emit('end');
      });
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/analyze',
      );

      assert.strictEqual(res.statusCode, 400);
    });

    it('returns 404 for an unknown session id', async () => {
      const res = mockRes();
      await router.dispatch(
        mockPost({sessionId: 'nope'}),
        res as unknown as ServerResponse,
        '/api/session/analyze',
      );

      assert.strictEqual(res.statusCode, 404);
      const body = res.body as {error: {code: string}};
      assert.strictEqual(body.error.code, 'NOT_FOUND');
    });

    it('returns 503 when session services are unavailable', async () => {
      const bare = new RestRouter();
      bare.mount(createSessionRoutes(() => undefined));
      const res = mockRes();
      await bare.dispatch(
        mockPost({}),
        res as unknown as ServerResponse,
        '/api/session/analyze',
      );

      assert.strictEqual(res.statusCode, 503);
    });
  });
});
