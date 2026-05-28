/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {EventEmitter} from 'node:events';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {beforeEach, describe, it} from 'node:test';

import {RestRouter} from '../../../src/web/RestRouter.js';

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  headersSent: boolean;
  setHeader(k: string, v: string): void;
  end(payload: string): void;
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

describe('RestRouter', () => {
  let router: RestRouter;
  let res: MockRes;

  beforeEach(() => {
    router = new RestRouter();
    res = mockRes();
  });

  it('matches an exact GET path and invokes the handler', async () => {
    let invoked = 0;
    router.mount(
      new Map([
        [
          'GET /api/health',
          (_req, r) => {
            invoked++;
            (r as unknown as MockRes).end('{"ok":true}');
          },
        ],
      ]),
    );

    const matched = await router.dispatch(
      mockReq('GET', '/api/health'),
      res as unknown as ServerResponse,
      '/api/health',
    );
    assert.strictEqual(matched, true);
    assert.strictEqual(invoked, 1);
    assert.strictEqual(res.body, '{"ok":true}');
  });

  it('extracts a single :param from the path', async () => {
    let captured: Record<string, string> | undefined;
    router.mount(
      new Map([
        [
          'GET /api/invocations/:id',
          (_req, _r, params) => {
            captured = params;
          },
        ],
      ]),
    );

    const ok = await router.dispatch(
      mockReq('GET', '/api/invocations/rec_abc_001'),
      res as unknown as ServerResponse,
      '/api/invocations/rec_abc_001',
    );
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(captured, {id: 'rec_abc_001'});
  });

  it('extracts URL-encoded :param via decodeURIComponent', async () => {
    let captured: Record<string, string> | undefined;
    router.mount(
      new Map([
        [
          'POST /api/tools/:name',
          (_req, _r, params) => {
            captured = params;
          },
        ],
      ]),
    );

    await router.dispatch(
      mockReq('POST', '/api/tools/collect%5Fscripts'),
      res as unknown as ServerResponse,
      '/api/tools/collect%5Fscripts',
    );
    assert.deepStrictEqual(captured, {name: 'collect_scripts'});
  });

  it('returns false when no route matches the method or path', async () => {
    router.mount(
      new Map([
        [
          'GET /api/health',
          () => {
            /* noop */
          },
        ],
      ]),
    );

    const wrongPath = await router.dispatch(
      mockReq('GET', '/api/notfound'),
      res as unknown as ServerResponse,
      '/api/notfound',
    );
    assert.strictEqual(wrongPath, false);

    const wrongMethod = await router.dispatch(
      mockReq('POST', '/api/health'),
      res as unknown as ServerResponse,
      '/api/health',
    );
    assert.strictEqual(wrongMethod, false);
  });

  it('handles trailing slash equivalently', async () => {
    let invoked = 0;
    router.mount(
      new Map([
        [
          'GET /api/health',
          () => {
            invoked++;
          },
        ],
      ]),
    );

    await router.dispatch(
      mockReq('GET', '/api/health/'),
      res as unknown as ServerResponse,
      '/api/health/',
    );
    assert.strictEqual(invoked, 1);
  });

  it('catches handler errors and emits 500 INTERNAL response', async () => {
    router.mount(
      new Map([
        [
          'GET /api/boom',
          () => {
            throw new Error('handler exploded');
          },
        ],
      ]),
    );

    const matched = await router.dispatch(
      mockReq('GET', '/api/boom'),
      res as unknown as ServerResponse,
      '/api/boom',
    );
    assert.strictEqual(matched, true);
    assert.strictEqual(res.statusCode, 500);
    const parsed = JSON.parse(res.body) as {
      success: boolean;
      error: {code: string; message: string};
    };
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'INTERNAL');
    assert.strictEqual(parsed.error.message, 'handler exploded');
  });

  it('does not double-write 500 if handler already sent headers', async () => {
    router.mount(
      new Map([
        [
          'GET /api/partial',
          (_req, r) => {
            (r as unknown as MockRes).end('"partial"');
            throw new Error('after-send error');
          },
        ],
      ]),
    );

    await router.dispatch(
      mockReq('GET', '/api/partial'),
      res as unknown as ServerResponse,
      '/api/partial',
    );
    // body should still be the original payload, not overwritten with INTERNAL
    assert.strictEqual(res.body, '"partial"');
    assert.notStrictEqual(res.statusCode, 500);
  });

  it('first-registered route wins on ambiguous matches', async () => {
    let firstInvoked = 0;
    let secondInvoked = 0;
    router.mount(
      new Map([
        [
          'GET /api/x/:id',
          () => {
            firstInvoked++;
          },
        ],
        [
          'GET /api/x/:slug',
          () => {
            secondInvoked++;
          },
        ],
      ]),
    );

    await router.dispatch(
      mockReq('GET', '/api/x/abc'),
      res as unknown as ServerResponse,
      '/api/x/abc',
    );
    assert.strictEqual(firstInvoked, 1);
    assert.strictEqual(secondInvoked, 0);
  });
});
