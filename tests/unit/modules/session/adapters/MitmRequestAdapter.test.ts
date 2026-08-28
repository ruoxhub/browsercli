/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {CapturedExchange} from '../../../../../src/modules/proxy/types.js';
import {toCapturedRequestInput} from '../../../../../src/modules/session/adapters/MitmRequestAdapter.js';

function makeExchange(
  overrides: Partial<CapturedExchange> = {},
): CapturedExchange {
  return {
    requestId: 'req-1',
    method: 'POST',
    url: 'https://a.dev/sign',
    requestHeaders: {'content-type': 'application/json'},
    requestBody: '{"q":1}',
    statusCode: 200,
    responseHeaders: {'content-type': 'application/json'},
    responseBody: '{"ok":true}',
    contentType: 'application/json',
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: 1700000000000,
    ...overrides,
  };
}

describe('MitmRequestAdapter', () => {
  it('maps headers to JSON strings and flags to 0/1', () => {
    const input = toCapturedRequestInput(makeExchange());
    assert.strictEqual(input.source, 'proxy');
    assert.strictEqual(
      input.requestHeaders,
      '{"content-type":"application/json"}',
    );
    assert.strictEqual(
      input.responseHeaders,
      '{"content-type":"application/json"}',
    );
    assert.strictEqual(input.isStreaming, 0);
    assert.strictEqual(input.isWebSocket, 0);
    assert.strictEqual(input.truncated, 0);
  });

  it('carries through true flags and the exchange timestamp', () => {
    const input = toCapturedRequestInput(
      makeExchange({
        isStreaming: true,
        isWebSocket: true,
        truncated: true,
        timestamp: 42,
      }),
    );
    assert.strictEqual(input.isStreaming, 1);
    assert.strictEqual(input.isWebSocket, 1);
    assert.strictEqual(input.truncated, 1);
    assert.strictEqual(input.timestamp, 42);
  });

  it('nulls the columns MITM cannot supply', () => {
    const input = toCapturedRequestInput(
      makeExchange({requestBody: null, responseBody: null, contentType: null}),
    );
    assert.strictEqual(input.requestBody, null);
    assert.strictEqual(input.responseBody, null);
    assert.strictEqual(input.contentType, null);
    assert.strictEqual(input.initiator, null);
    assert.strictEqual(input.durationMs, 0);
  });

  it('degrades malformed header records to an empty JSON object', () => {
    const input = toCapturedRequestInput(
      makeExchange({
        requestHeaders: undefined as unknown as Record<string, string>,
      }),
    );
    assert.strictEqual(input.requestHeaders, '{}');
  });
});
