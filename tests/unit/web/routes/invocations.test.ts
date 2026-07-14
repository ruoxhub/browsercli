/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {beforeEach, describe, it} from 'node:test';

import {InvocationStore} from '../../../../src/web/adapters/InvocationStore.js';
import {RestRouter} from '../../../../src/web/RestRouter.js';
import {createInvocationsRoutes} from '../../../../src/web/routes/invocations.js';
import type {InvocationRecord} from '../../../../src/web/types.js';

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

const baseRecord: Omit<InvocationRecord, 'id'> = {
  traceId: 'tr_test',
  toolName: 'collect_scripts',
  success: true,
  startedAt: '2026-05-27T00:00:00.000Z',
  durationMs: 7,
};

describe('createInvocationsRoutes', () => {
  let store: InvocationStore;
  let router: RestRouter;

  beforeEach(() => {
    store = new InvocationStore();
    router = new RestRouter();
    router.mount(createInvocationsRoutes({store}));
  });

  it('GET /api/invocations returns recent records (default limit 100)', async () => {
    store.add({...baseRecord, traceId: 'tr_1'});
    store.add({...baseRecord, traceId: 'tr_2'});
    store.add({...baseRecord, traceId: 'tr_3'});

    const res = mockRes();
    const matched = await router.dispatch(
      mockReq('GET', '/api/invocations'),
      res as unknown as ServerResponse,
      '/api/invocations',
    );
    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body) as {
      success: boolean;
      data: {
        records: InvocationRecord[];
        total: number;
        limit: number;
      };
    };
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.total, 3);
    assert.strictEqual(parsed.data.limit, 100);
    assert.deepStrictEqual(
      parsed.data.records.map(r => r.traceId),
      ['tr_3', 'tr_2', 'tr_1'],
    );
  });

  it('GET /api/invocations?limit=N respects limit param', async () => {
    for (let i = 0; i < 5; i++) {
      store.add({...baseRecord, traceId: `tr_${i}`});
    }
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/invocations?limit=2'),
      res as unknown as ServerResponse,
      '/api/invocations',
    );
    const parsed = JSON.parse(res.body) as {
      data: {records: InvocationRecord[]; limit: number};
    };
    assert.strictEqual(parsed.data.limit, 2);
    assert.strictEqual(parsed.data.records.length, 2);
    assert.deepStrictEqual(
      parsed.data.records.map(r => r.traceId),
      ['tr_4', 'tr_3'],
    );
  });

  it('GET /api/invocations?limit=invalid falls back to default 100', async () => {
    store.add({...baseRecord});
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/invocations?limit=abc'),
      res as unknown as ServerResponse,
      '/api/invocations',
    );
    const parsed = JSON.parse(res.body) as {data: {limit: number}};
    assert.strictEqual(parsed.data.limit, 100);
  });

  it('GET /api/invocations?limit=99999 caps at MAX_LIMIT (1000)', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/invocations?limit=99999'),
      res as unknown as ServerResponse,
      '/api/invocations',
    );
    const parsed = JSON.parse(res.body) as {data: {limit: number}};
    assert.strictEqual(parsed.data.limit, 1000);
  });

  it('GET /api/invocations/:id returns matching record', async () => {
    const r = store.add({...baseRecord, traceId: 'tr_match'});

    const res = mockRes();
    await router.dispatch(
      mockReq('GET', `/api/invocations/${r.id}`),
      res as unknown as ServerResponse,
      `/api/invocations/${r.id}`,
    );
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      data: InvocationRecord;
    };
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.id, r.id);
    assert.strictEqual(parsed.data.traceId, 'tr_match');
  });

  it('GET /api/invocations/:id returns 404 NOT_FOUND for unknown id', async () => {
    const res = mockRes();
    await router.dispatch(
      mockReq('GET', '/api/invocations/rec_nonexistent'),
      res as unknown as ServerResponse,
      '/api/invocations/rec_nonexistent',
    );
    assert.strictEqual(res.statusCode, 404);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      error: {code: string};
    };
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'NOT_FOUND');
  });
});
