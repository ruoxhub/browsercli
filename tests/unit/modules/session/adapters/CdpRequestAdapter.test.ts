/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Response} from 'patchright';

import {MAX_CAPTURED_BODY_BYTES} from '../../../../../src/modules/network/constants.js';
import {cdpResponseToInput} from '../../../../../src/modules/session/adapters/CdpRequestAdapter.js';

interface FakeResponseOptions {
  contentType?: string | null;
  body?: string | null;
  postData?: string | null;
}

function makeResponse(opts: FakeResponseOptions): Response {
  const headers: Record<string, string> = {};
  if (opts.contentType) {
    headers['content-type'] = opts.contentType;
  }
  const request = {
    method: () => 'POST',
    url: () => 'https://a.dev/sign',
    headers: () => ({cookie: 'x=1'}),
    postData: () => opts.postData ?? '{"q":1}',
  };
  return {
    status: () => 204,
    headers: () => headers,
    request: () => request,
    text: async () => opts.body ?? '',
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
    assert.strictEqual(input.statusCode, 204);
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
