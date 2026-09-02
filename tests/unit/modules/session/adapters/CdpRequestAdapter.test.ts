/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Response} from 'patchright';

import {MAX_CAPTURED_BODY_BYTES} from '../../../../../src/modules/network/constants.js';
import {
  cdpResponseToInput,
  readCdpResponseBody,
} from '../../../../../src/modules/session/adapters/CdpRequestAdapter.js';

interface FakeResponseOptions {
  method?: string;
  status?: number;
  contentType?: string | null;
  contentLength?: string;
  body?: string | null;
  postData?: string | null;
  textThrows?: boolean;
}

function makeResponse(opts: FakeResponseOptions): Response {
  const headers: Record<string, string> = {};
  if (opts.contentType) {
    headers['content-type'] = opts.contentType;
  }
  if (opts.contentLength !== undefined) {
    headers['content-length'] = opts.contentLength;
  }
  const request = {
    method: () => opts.method ?? 'POST',
    url: () => 'https://a.dev/sign',
    headers: () => ({cookie: 'x=1'}),
    postData: () => opts.postData ?? '{"q":1}',
  };
  return {
    status: () => opts.status ?? 200,
    headers: () => headers,
    url: () => 'https://a.dev/sign',
    request: () => request,
    text: async () => {
      if (opts.textThrows) {
        throw new Error('disposed');
      }
      return opts.body ?? '';
    },
  } as unknown as Response;
}

describe('cdpResponseToInput', () => {
  it('maps request fields and pins source to cdp', async () => {
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'application/json', body: '{"ok":true}'}),
      {readBody: async () => '{"ok":true}'},
    );
    assert.strictEqual(input.source, 'cdp');
    assert.strictEqual(input.method, 'POST');
    assert.strictEqual(input.url, 'https://a.dev/sign');
    assert.strictEqual(input.statusCode, 200);
    assert.strictEqual(input.requestBody, '{"q":1}');
    assert.strictEqual(input.responseBody, '{"ok":true}');
    assert.strictEqual(input.contentType, 'application/json');
    assert.strictEqual(input.requestHeaders, '{"cookie":"x=1"}');
    assert.strictEqual(
      input.responseHeaders,
      '{"content-type":"application/json"}',
    );
    assert.strictEqual(input.initiator, null);
    assert.strictEqual(input.durationMs, 0);
    assert.strictEqual(input.isWebSocket, 0);
  });

  it('reads the timestamp before awaiting the body (spec §5 / r2.1)', async () => {
    const order: string[] = [];
    await cdpResponseToInput(makeResponse({contentType: 'application/json'}), {
      now: () => {
        order.push('now');
        return 123;
      },
      readBody: async () => {
        order.push('readBody');
        return 'b';
      },
    });
    assert.deepStrictEqual(order, ['now', 'readBody']);
  });

  it('skips the body for non-whitelisted content types', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'image/png'}),
      {
        readBody: async () => {
          called += 1;
          return 'never';
        },
      },
    );
    assert.strictEqual(called, 0);
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.truncated, 0);
  });

  it('marks SSE as streaming without reading the body', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'text/event-stream'}),
      {
        readBody: async () => {
          called += 1;
          return 'never';
        },
      },
    );
    assert.strictEqual(called, 0, 'SSE 取体会挂起');
    assert.strictEqual(input.isStreaming, 1);
    assert.strictEqual(input.responseBody, null);
  });

  it('truncates an oversized body and flags it', async () => {
    const big = 'a'.repeat(MAX_CAPTURED_BODY_BYTES + 10);
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'text/plain'}),
      {readBody: async () => big},
    );
    assert.strictEqual(input.truncated, 1);
    assert.strictEqual(
      (input.responseBody as string).length,
      MAX_CAPTURED_BODY_BYTES,
    );
  });

  it('degrades a null body read without throwing', async () => {
    const input = await cdpResponseToInput(
      makeResponse({contentType: 'application/json'}),
      {readBody: async () => null},
    );
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.truncated, 0);
  });

  it('skips the body for redirect responses without reading it', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({status: 302, contentType: 'text/html'}),
      {
        readBody: async () => {
          called += 1;
          return 'redirect-body';
        },
      },
    );
    assert.strictEqual(called, 0, '重定向响应不该取体');
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.statusCode, 302);
  });

  it('still reads the body for a 2xx response', async () => {
    const input = await cdpResponseToInput(
      makeResponse({status: 200, contentType: 'text/html'}),
      {readBody: async () => 'ok'},
    );
    assert.strictEqual(input.responseBody, 'ok');
  });

  it('skips the body for 204, 205, 304, and 1xx responses without reading it', async () => {
    for (const status of [204, 205, 304, 101]) {
      let called = 0;
      const input = await cdpResponseToInput(
        makeResponse({status, contentType: 'application/json'}),
        {
          readBody: async () => {
            called += 1;
            return 'no-content-body';
          },
        },
      );
      assert.strictEqual(called, 0, `HTTP ${status} 不该取体`);
      assert.strictEqual(input.responseBody, null);
      assert.strictEqual(input.statusCode, status);
    }
  });

  it('skips the body for HEAD requests without reading it', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({method: 'HEAD', contentType: 'application/json'}),
      {
        readBody: async () => {
          called += 1;
          return 'head-body';
        },
      },
    );
    assert.strictEqual(called, 0, 'HEAD 请求不该取体');
    assert.strictEqual(input.responseBody, null);
  });

  it('sets empty body for Content-Length 0 without reading it', async () => {
    let called = 0;
    const input = await cdpResponseToInput(
      makeResponse({
        status: 200,
        contentType: 'application/json',
        contentLength: '0',
      }),
      {
        readBody: async () => {
          called += 1;
          return 'zero-body';
        },
      },
    );
    assert.strictEqual(called, 0, 'Content-Length: 0 不该发起 CDP 取体');
    assert.strictEqual(input.responseBody, '');
  });

  it('survives a request whose headers/postData accessors throw', async () => {
    const broken = {
      status: () => 500,
      headers: () => ({}),
      request: () => ({
        method: () => 'GET',
        url: () => 'https://a.dev/x',
        headers: () => {
          throw new Error('disposed');
        },
        postData: () => {
          throw new Error('disposed');
        },
      }),
    } as unknown as Response;
    const input = await cdpResponseToInput(broken, {
      readBody: async () => null,
    });
    assert.strictEqual(input.requestHeaders, '{}');
    assert.strictEqual(input.requestBody, null);
    assert.strictEqual(input.statusCode, 500);
  });
});

describe('readCdpResponseBody', () => {
  it('reads response body text successfully', async () => {
    const res = makeResponse({body: '{"status":"healthy"}'});
    const result = await readCdpResponseBody(res);
    assert.strictEqual(result, '{"status":"healthy"}');
  });

  it('returns null gracefully when response.text() throws', async () => {
    const res = makeResponse({textThrows: true});
    const result = await readCdpResponseBody(res);
    assert.strictEqual(result, null);
  });
});
