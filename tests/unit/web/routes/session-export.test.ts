/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {describe, it} from 'node:test';

import {DatabaseManager} from '../../../../src/database/DatabaseManager.js';
import {CaptureSessionManager} from '../../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../../src/modules/session/SqliteSessionStore.js';
import type {CapturedRequestRow} from '../../../../src/modules/session/types.js';
import {RestRouter} from '../../../../src/web/RestRouter.js';
import {
  createSessionRoutes,
  type SessionServices,
} from '../../../../src/web/routes/session.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string | Buffer;
  setHeader(k: string, v: string | number): void;
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  end(payload?: string | Buffer): void;
  headersSent: boolean;
}

function mockReq(
  method: string,
  url: string,
  bodyObj?: Record<string, unknown>,
): IncomingMessage {
  const e = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
  };
  e.method = method;
  e.url = url;
  if (bodyObj !== undefined) {
    process.nextTick(() => {
      e.emit('data', Buffer.from(JSON.stringify(bodyObj)));
      e.emit('end');
    });
  } else {
    process.nextTick(() => {
      e.emit('end');
    });
  }
  return e;
}

function mockRes(): MockRes {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = String(v);
    },
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          this.headers[k.toLowerCase()] = String(v);
        }
      }
    },
    end(payload?: string | Buffer) {
      if (payload !== undefined) {
        this.body = payload;
      }
      this.headersSent = true;
    },
  };
}

function makeTestHarness(): {
  router: RestRouter;
  store: SqliteSessionStore;
  manager: CaptureSessionManager;
  dbManager: DatabaseManager;
} {
  const dbManager = new DatabaseManager(':memory:');
  const store = new SqliteSessionStore(dbManager);
  const manager = new CaptureSessionManager(store);

  const services: SessionServices = {
    manager,
    store,
  };

  const router = new RestRouter();
  router.mount(createSessionRoutes(() => services));

  return {router, store, manager, dbManager};
}

let mockSeq = 0;
function addMockRequest(
  store: SqliteSessionStore,
  id: string,
  sessionId: string,
  method: string,
  url: string,
  statusCode = 200,
): CapturedRequestRow {
  const row: CapturedRequestRow = {
    id,
    sessionId,
    sequence: ++mockSeq,
    timestamp: Date.now(),
    method,
    url,
    source: 'proxy',
    requestHeaders: JSON.stringify({
      'content-type': 'application/json',
      authorization: 'Bearer token-123',
    }),
    requestBody: JSON.stringify({query: 'test'}),
    statusCode,
    responseHeaders: JSON.stringify({'content-type': 'application/json'}),
    responseBody: JSON.stringify({result: 'ok'}),
    contentType: 'application/json',
    initiator: 'test-proc',
    durationMs: 25,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
  };
  store.appendRequest(row);
  return row;
}

describe('session export routes', () => {
  it('POST /api/session/export returns 503 when no active session', async () => {
    const {router, dbManager} = makeTestHarness();
    try {
      const req = mockReq('POST', '/api/session/export', {format: 'har'});
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/export',
      );
      assert.strictEqual(res.statusCode, 503);
    } finally {
      dbManager.close();
    }
  });

  it('POST /api/session/export validates format', async () => {
    const {router, manager, dbManager} = makeTestHarness();
    try {
      manager.createSession({name: 'demo'});
      const req = mockReq('POST', '/api/session/export', {format: 'invalid'});
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/export',
      );
      assert.strictEqual(res.statusCode, 400);
    } finally {
      dbManager.close();
    }
  });

  it('POST /api/session/export exports HAR by default', async () => {
    const {router, store, manager, dbManager} = makeTestHarness();
    try {
      const session = manager.createSession({name: 'demo'});
      addMockRequest(store, 'r1', session.id, 'POST', 'https://api.test/login');
      addMockRequest(store, 'r2', session.id, 'GET', 'https://api.test/user');

      const req = mockReq('POST', '/api/session/export', {format: 'har'});
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/export',
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(
        res.headers['content-type'],
        'application/json; charset=utf-8',
      );
      assert.ok(res.headers['content-disposition'].includes('.har'));
      assert.strictEqual(res.headers['x-export-count'], '2');

      const har = JSON.parse(String(res.body));
      assert.strictEqual(har.log.version, '1.2');
      assert.strictEqual(har.log.entries.length, 2);
    } finally {
      dbManager.close();
    }
  });

  it('POST /api/session/export filters by selected ids', async () => {
    const {router, store, manager, dbManager} = makeTestHarness();
    try {
      const session = manager.createSession({name: 'demo'});
      addMockRequest(store, 'r1', session.id, 'POST', 'https://api.test/1');
      addMockRequest(store, 'r2', session.id, 'GET', 'https://api.test/2');
      addMockRequest(store, 'r3', session.id, 'GET', 'https://api.test/3');

      const req = mockReq('POST', '/api/session/export', {
        format: 'json',
        ids: ['r1', 'r3'],
      });
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/export',
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['x-export-count'], '2');

      const parsed = JSON.parse(String(res.body)) as {
        requests: Array<{id: string}>;
      };
      assert.strictEqual(parsed.requests.length, 2);
      assert.deepStrictEqual(
        parsed.requests.map(r => r.id),
        ['r1', 'r3'],
      );
    } finally {
      dbManager.close();
    }
  });

  it('POST /api/session/export supports cURL script format and desensitization', async () => {
    const {router, store, manager, dbManager} = makeTestHarness();
    try {
      const session = manager.createSession({name: 'demo'});
      addMockRequest(store, 'r1', session.id, 'POST', 'https://api.test/login');

      const req = mockReq('POST', '/api/session/export', {
        format: 'curl',
        desensitize: true,
      });
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/export',
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(
        res.headers['content-type'],
        'application/x-sh; charset=utf-8',
      );
      assert.ok(res.headers['content-disposition'].includes('.sh'));

      const script = String(res.body);
      assert.ok(script.includes('#!/usr/bin/env bash'));
      assert.ok(script.includes('curl -X POST'));
      assert.ok(script.includes('[REDACTED]'));
    } finally {
      dbManager.close();
    }
  });

  it('GET /api/session/export supports query params export', async () => {
    const {router, store, manager, dbManager} = makeTestHarness();
    try {
      const session = manager.createSession({name: 'demo'});
      addMockRequest(store, 'r1', session.id, 'POST', 'https://api.test/login');

      const req = mockReq('GET', '/api/session/export?format=json');
      const res = mockRes();
      await router.dispatch(
        req,
        res as unknown as ServerResponse,
        '/api/session/export',
      );

      assert.strictEqual(res.statusCode, 200);
      const parsed = JSON.parse(String(res.body));
      assert.strictEqual(parsed.total, 1);
    } finally {
      dbManager.close();
    }
  });
});
