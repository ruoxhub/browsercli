/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {TrafficPurifier} from '../../../../../src/modules/analyzer/ai/TrafficPurifier.js';
import type {CapturedRequestRow} from '../../../../../src/modules/session/types.js';

function createMockRequest(
  overrides: Partial<CapturedRequestRow> = {},
): CapturedRequestRow {
  return {
    id: 'req-1',
    sessionId: 'session-1',
    sequence: 1,
    timestamp: 1700000000000,
    method: 'GET',
    url: 'https://example.com/api/v1/resource',
    source: 'cdp',
    requestHeaders: '{}',
    requestBody: null,
    statusCode: 200,
    responseHeaders: null,
    responseBody: null,
    contentType: 'application/json',
    initiator: null,
    durationMs: 50,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
    ...overrides,
  };
}

describe('TrafficPurifier', () => {
  const purifier = new TrafficPurifier();

  it('filters static file resources (.png, .jpg, .css, .woff, .map, etc.)', () => {
    const requests: CapturedRequestRow[] = [
      createMockRequest({
        sequence: 1,
        url: 'https://example.com/assets/logo.png',
        contentType: 'image/png',
      }),
      createMockRequest({
        sequence: 2,
        url: 'https://example.com/styles/main.css?v=123',
        contentType: 'text/css',
      }),
      createMockRequest({
        sequence: 3,
        url: 'https://example.com/fonts/inter.woff2',
        contentType: 'font/woff2',
      }),
      createMockRequest({
        sequence: 4,
        url: 'https://example.com/static/bundle.js.map',
        contentType: 'application/json',
      }),
      createMockRequest({
        sequence: 5,
        url: 'https://example.com/favicon.ico',
        contentType: 'image/x-icon',
      }),
      createMockRequest({
        sequence: 6,
        url: 'https://example.com/api/v1/users',
        contentType: 'application/json',
      }),
    ];

    const purified = purifier.purify(requests);

    assert.strictEqual(purified.length, 1);
    assert.strictEqual(purified[0].url, 'https://example.com/api/v1/users');
    assert.strictEqual(purified[0].sequence, 6);
  });

  it('filters tracking and analytics domains', () => {
    const requests: CapturedRequestRow[] = [
      createMockRequest({
        sequence: 1,
        url: 'https://www.google-analytics.com/g/collect?v=2',
      }),
      createMockRequest({
        sequence: 2,
        url: 'https://googletagmanager.com/gtm.js?id=GTM-123',
      }),
      createMockRequest({
        sequence: 3,
        url: 'https://stats.g.doubleclick.net/r/collect',
      }),
      createMockRequest({
        sequence: 4,
        url: 'https://o12345.ingest.sentry.io/api/123/envelope/',
      }),
      createMockRequest({
        sequence: 5,
        url: 'https://c.clarity.ms/collect',
      }),
      createMockRequest({
        sequence: 6,
        url: 'https://in.hotjar.com/api/v2/client/events',
      }),
      createMockRequest({
        sequence: 7,
        url: 'https://api.segment.io/v1/t',
      }),
      createMockRequest({
        sequence: 8,
        url: 'https://api.mixpanel.com/track',
      }),
      createMockRequest({
        sequence: 9,
        url: 'https://api2.amplitude.com/2/httpapi',
      }),
      createMockRequest({
        sequence: 10,
        url: 'https://notify.bugsnag.com/js',
      }),
      createMockRequest({
        sequence: 11,
        url: 'https://api.mysite.com/v1/data',
      }),
    ];

    const purified = purifier.purify(requests);

    assert.strictEqual(purified.length, 1);
    assert.strictEqual(purified[0].url, 'https://api.mysite.com/v1/data');
    assert.strictEqual(purified[0].sequence, 11);
  });

  it('extracts key headers while stripping noisy browser-internal headers', () => {
    const rawHeaders = {
      Authorization: 'Bearer secret_jwt_token',
      Cookie: 'session_id=s_12345; auth=true',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://mysite.com/dashboard',
      'X-Auth-Token': 'x_tok_9988',
      'X-Sign': 'abcdef0123456789',
      'custom-token': 'custom_val',
      'sec-ch-ua': '"Chromium";v="120"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-US,en;q=0.9',
      connection: 'keep-alive',
      host: 'mysite.com',
    };

    const req = createMockRequest({
      sequence: 1,
      url: 'https://mysite.com/api/orders',
      requestHeaders: JSON.stringify(rawHeaders),
    });

    const purified = purifier.purify([req]);

    assert.strictEqual(purified.length, 1);
    const keyHeaders = purified[0].keyHeaders;

    // Retained headers
    assert.strictEqual(keyHeaders['Authorization'], 'Bearer secret_jwt_token');
    assert.strictEqual(keyHeaders['Cookie'], 'session_id=s_12345; auth=true');
    assert.strictEqual(keyHeaders['Content-Type'], 'application/json');
    assert.strictEqual(
      keyHeaders['User-Agent'],
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );
    assert.strictEqual(keyHeaders['Referer'], 'https://mysite.com/dashboard');
    assert.strictEqual(keyHeaders['X-Auth-Token'], 'x_tok_9988');
    assert.strictEqual(keyHeaders['X-Sign'], 'abcdef0123456789');
    assert.strictEqual(keyHeaders['custom-token'], 'custom_val');

    // Stripped headers
    assert.strictEqual(keyHeaders['sec-ch-ua'], undefined);
    assert.strictEqual(keyHeaders['sec-fetch-dest'], undefined);
    assert.strictEqual(keyHeaders['sec-fetch-mode'], undefined);
    assert.strictEqual(keyHeaders['sec-fetch-site'], undefined);
    assert.strictEqual(keyHeaders['accept-encoding'], undefined);
    assert.strictEqual(keyHeaders['accept-language'], undefined);
    assert.strictEqual(keyHeaders['connection'], undefined);
    assert.strictEqual(keyHeaders['host'], undefined);
  });

  it('formats body and response previews cleanly with truncation', () => {
    const longRequestBody = 'A'.repeat(1500);
    const longResponseBody = '{"data":"' + 'B'.repeat(1500) + '"}';

    const req = createMockRequest({
      sequence: 1,
      url: 'https://mysite.com/api/big',
      requestBody: longRequestBody,
      responseBody: longResponseBody,
      contentType: 'application/json',
    });

    const purified = purifier.purify([req]);

    assert.strictEqual(purified.length, 1);
    assert.ok(purified[0].bodyPreview);
    assert.ok(purified[0].bodyPreview.length <= 1005);
    assert.ok(purified[0].bodyPreview.endsWith('...'));

    assert.ok(purified[0].responsePreview);
    assert.ok(purified[0].responsePreview.length <= 1005);
    assert.ok(purified[0].responsePreview.endsWith('...'));
  });

  it('indicates [Binary Data] when response is empty binary content-type', () => {
    const req = createMockRequest({
      sequence: 1,
      url: 'https://mysite.com/api/export.pdf',
      requestBody: null,
      responseBody: null,
      contentType: 'application/pdf',
    });

    const purified = purifier.purify([req]);

    assert.strictEqual(purified.length, 1);
    assert.strictEqual(purified[0].bodyPreview, null);
    assert.strictEqual(purified[0].responsePreview, '[Binary Data]');
  });

  it('sorts output by sequence ASC and caps to options.maxRequests', () => {
    const requests: CapturedRequestRow[] = [
      createMockRequest({sequence: 50, url: 'https://mysite.com/api/50'}),
      createMockRequest({sequence: 10, url: 'https://mysite.com/api/10'}),
      createMockRequest({sequence: 30, url: 'https://mysite.com/api/30'}),
      createMockRequest({sequence: 20, url: 'https://mysite.com/api/20'}),
      createMockRequest({sequence: 40, url: 'https://mysite.com/api/40'}),
    ];

    const purified = purifier.purify(requests, {maxRequests: 3});

    assert.strictEqual(purified.length, 3);
    assert.strictEqual(purified[0].sequence, 10);
    assert.strictEqual(purified[1].sequence, 20);
    assert.strictEqual(purified[2].sequence, 30);
  });

  it('maps all required PurifiedRequest fields properly', () => {
    const req = createMockRequest({
      sequence: 42,
      method: 'POST',
      url: 'https://mysite.com/api/checkout',
      source: 'proxy',
      statusCode: 201,
      durationMs: 120,
      contentType: 'application/json',
      requestHeaders: JSON.stringify({Authorization: 'Bearer 123'}),
      requestBody: '{"item":"book"}',
      responseBody: '{"orderId":"999"}',
      isStreaming: 0,
      isWebSocket: 0,
    });

    const purified = purifier.purify([req]);

    assert.strictEqual(purified.length, 1);
    const item = purified[0];

    assert.strictEqual(item.sequence, 42);
    assert.strictEqual(item.method, 'POST');
    assert.strictEqual(item.url, 'https://mysite.com/api/checkout');
    assert.strictEqual(item.source, 'proxy');
    assert.strictEqual(item.statusCode, 201);
    assert.strictEqual(item.durationMs, 120);
    assert.strictEqual(item.contentType, 'application/json');
    assert.deepStrictEqual(item.keyHeaders, {Authorization: 'Bearer 123'});
    assert.strictEqual(item.bodyPreview, '{"item":"book"}');
    assert.strictEqual(item.responsePreview, '{"orderId":"999"}');
    assert.strictEqual(item.isStreaming, 0);
    assert.strictEqual(item.isWebSocket, 0);
  });

  it('handles invalid json in requestHeaders and malformed URLs gracefully', () => {
    const req = createMockRequest({
      sequence: 1,
      url: 'not-a-valid-url',
      requestHeaders: 'invalid-json{{{',
      requestBody: null,
      responseBody: null,
      contentType: null,
    });

    const purified = purifier.purify([req]);

    assert.strictEqual(purified.length, 1);
    assert.deepStrictEqual(purified[0].keyHeaders, {});
    assert.strictEqual(purified[0].bodyPreview, null);
    assert.strictEqual(purified[0].responsePreview, null);
  });

  it('returns empty array when input is empty', () => {
    const purified = purifier.purify([]);
    assert.deepStrictEqual(purified, []);
  });
});
