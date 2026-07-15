/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {beforeEach, describe, it} from 'node:test';

import type {ToolMeta} from '../../../../src/tools/tools-meta.js';
import {InvocationStore} from '../../../../src/web/adapters/InvocationStore.js';
import {RestRouter} from '../../../../src/web/RestRouter.js';
import {createToolsRoutes} from '../../../../src/web/routes/tools.js';
import type {ToolAdapter} from '../../../../src/worker/ToolAdapter.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(k: string, v: string): void;
  end(payload: string): void;
  headersSent: boolean;
}

function mockReq(method: string, url: string): IncomingMessage {
  const e = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  e.method = method;
  e.url = url;
  return e;
}

function mockReqWithBody(
  method: string,
  url: string,
  body: unknown,
): IncomingMessage {
  const e = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  e.method = method;
  e.url = url;
  process.nextTick(() => {
    if (body !== undefined) {
      e.emit('data', Buffer.from(JSON.stringify(body)));
    }
    e.emit('end');
  });
  return e;
}

function mockRes(): MockRes {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(payload: string) {
      this.body = payload;
      this.headersSent = true;
    },
  };
}

describe('createToolsRoutes', () => {
  let store: InvocationStore;
  let router: RestRouter;
  let calls: Array<{meta: ToolMeta; args: Record<string, unknown>}>;
  let toolAdapter: ToolAdapter;

  beforeEach(() => {
    calls = [];
    store = new InvocationStore();
    toolAdapter = {
      executeTool: async (meta, args) => {
        calls.push({meta, args});
        return {pages: []};
      },
    } as unknown as ToolAdapter;
    router = new RestRouter();
    router.mount(
      createToolsRoutes({
        toolAdapter,
        invocations: store,
      }),
    );
  });

  it('POST /api/tools/:name extracts args from body.args and invokes executeTool', async () => {
    const res = mockRes();
    const matched = await router.dispatch(
      mockReqWithBody('POST', '/api/tools/list_pages', {args: {active: true}}),
      res as unknown as ServerResponse,
      '/api/tools/list_pages',
    );
    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body) as {
      success: boolean;
      data: {result: unknown; traceId: string; durationMs: number};
    };
    assert.strictEqual(parsed.success, true);
    assert.deepStrictEqual(parsed.data.result, {pages: []});
    assert.ok(parsed.data.traceId.startsWith('tr_rest_'));
    assert.ok(parsed.data.durationMs >= 0);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].meta.name, 'list_pages');
    assert.deepStrictEqual(calls[0].args, {active: true});
  });

  it('POST /api/tools/:name returns 502 when executeTool throws', async () => {
    toolAdapter = {
      executeTool: async () => {
        throw new Error('page context missing');
      },
    } as unknown as ToolAdapter;
    router = new RestRouter();
    router.mount(
      createToolsRoutes({
        toolAdapter,
        invocations: store,
      }),
    );

    const res = mockRes();
    await router.dispatch(
      mockReqWithBody('POST', '/api/tools/list_pages', {args: {}}),
      res as unknown as ServerResponse,
      '/api/tools/list_pages',
    );
    assert.strictEqual(res.statusCode, 502);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      error: {code: string; message: string};
    };
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'INVOKE_FAILED');
    assert.ok(parsed.error.message.includes('page context missing'));
  });

  it('POST /api/tools/:name returns 404 for unknown tool', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReqWithBody('POST', '/api/tools/unknown_tool', {args: {}}),
      res as unknown as ServerResponse,
      '/api/tools/unknown_tool',
    );
    assert.strictEqual(res.statusCode, 404);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      error: {code: string};
    };
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'NOT_FOUND');
  });

  it('POST /api/tools/:name handles empty body as empty args', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReqWithBody('POST', '/api/tools/list_pages', {}),
      res as unknown as ServerResponse,
      '/api/tools/list_pages',
    );
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, {});
  });
});
