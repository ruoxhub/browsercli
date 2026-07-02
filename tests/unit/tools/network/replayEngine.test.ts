/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  STRIPPED_HEADERS,
  stripManagedHeaders,
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
  formatCurl,
} from '../../../../src/tools/network/replayEngine.js';
import type {APIRequestContext} from '../../../../src/third_party/index.js';
import type {
  BuiltReplayRequest,
  GetNetworkRequestData,
} from '../../../../src/tools/network/types.js';

const ORIGINAL: GetNetworkRequestData = {
  reqid: 1,
  url: 'https://api.example.com/v1/sign',
  method: 'POST',
  resourceType: 'xhr',
  statusCode: 200,
  requestHeaders: {
    'Content-Type': 'application/json',
    'X-Sign': 'original-signature',
    Host: 'api.example.com',
  },
  responseHeaders: {},
  postData: '{"foo":"bar"}',
};

describe('STRIPPED_HEADERS', () => {
  it('contains the 7 hop-by-hop / transport-managed headers', () => {
    assert.deepStrictEqual([...STRIPPED_HEADERS].sort(), [
      'accept-encoding',
      'connection',
      'content-encoding',
      'content-length',
      'host',
      'keep-alive',
      'transfer-encoding',
    ]);
  });
});

describe('stripManagedHeaders', () => {
  it('removes managed headers case-insensitively', () => {
    const input = {
      Host: 'example.com',
      'Content-Length': '42',
      CONNECTION: 'keep-alive',
      'Accept-Encoding': 'gzip',
      'Content-Encoding': 'br',
      'Transfer-Encoding': 'chunked',
      'Keep-Alive': 'timeout=5',
      'X-Custom': 'keep-me',
    };
    assert.deepStrictEqual(stripManagedHeaders(input), {
      'X-Custom': 'keep-me',
    });
  });

  it('preserves signature-bearing headers', () => {
    const input = {
      'X-Sign': 'abc123',
      Signature: 'def456',
      token: 'tok',
      auth: 'bearer xyz',
      nonce: 'n1',
      timestamp: '1700000000',
    };
    assert.deepStrictEqual(stripManagedHeaders(input), input);
  });

  it('returns empty object for empty input', () => {
    assert.deepStrictEqual(stripManagedHeaders({}), {});
  });
});

describe('buildReplayRequest', () => {
  it('mirrors original when no override given (method uppercased, headers stripped)', () => {
    const built = buildReplayRequest(ORIGINAL);
    assert.equal(built.method, 'POST');
    assert.equal(built.url, 'https://api.example.com/v1/sign');
    assert.deepStrictEqual(built.headers, {
      'Content-Type': 'application/json',
      'X-Sign': 'original-signature',
    });
    assert.equal(built.body, '{"foo":"bar"}');
  });

  it('merges override headers case-insensitively (override wins, keeps override casing)', () => {
    const built = buildReplayRequest(ORIGINAL, {
      headers: {'content-type': 'text/plain', 'X-Extra': 'val'},
    });
    assert.deepStrictEqual(built.headers, {
      'content-type': 'text/plain',
      'X-Sign': 'original-signature',
      'X-Extra': 'val',
    });
  });

  it('replaces headers wholesale when replaceHeaders=true', () => {
    const built = buildReplayRequest(ORIGINAL, {
      headers: {'X-Only': 'val'},
      replaceHeaders: true,
    });
    assert.deepStrictEqual(built.headers, {'X-Only': 'val'});
  });

  it('overrides method (uppercased) and url', () => {
    const built = buildReplayRequest(ORIGINAL, {
      method: 'put',
      url: 'https://api.example.com/v2/sign',
    });
    assert.equal(built.method, 'PUT');
    assert.equal(built.url, 'https://api.example.com/v2/sign');
  });

  it('keeps original body when body omitted', () => {
    const built = buildReplayRequest(ORIGINAL, {method: 'POST'});
    assert.equal(built.body, '{"foo":"bar"}');
  });

  it('clears body when body=null', () => {
    const built = buildReplayRequest(ORIGINAL, {body: null});
    assert.equal(built.body, undefined);
  });

  it('replaces body when body=string', () => {
    const built = buildReplayRequest(ORIGINAL, {body: '{"x":1}'});
    assert.equal(built.body, '{"x":1}');
  });
});

describe('emptyReplayResponse', () => {
  it('returns zero-shell with replayedUrl set from arg', () => {
    assert.deepStrictEqual(emptyReplayResponse('https://x.test/y'), {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      bodyTruncated: false,
      timingMs: 0,
      replayedUrl: 'https://x.test/y',
    });
  });
});

function createMockApiContext(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  throwOnFetch?: Error;
  throwOnBody?: Error;
}): APIRequestContext {
  const mockResponse = {
    status: () => opts.status ?? 200,
    statusText: () => opts.statusText ?? 'OK',
    headers: () => opts.headers ?? {'content-type': 'application/json'},
    text: async () => {
      if (opts.throwOnBody) {
        throw opts.throwOnBody;
      }
      return opts.body ?? '{"ok":true}';
    },
  };
  return {
    fetch: async () => {
      if (opts.throwOnFetch) {
        throw opts.throwOnFetch;
      }
      return mockResponse;
    },
  } as unknown as APIRequestContext;
}

describe('executeReplay', () => {
  it('returns normalized response on success', async () => {
    const ctx = createMockApiContext({
      status: 200,
      statusText: 'OK',
      headers: {'content-type': 'application/json'},
      body: '{"ok":true}',
    });
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {'X-Sign': 's'},
      body: '{"a":1}',
    };
    const result = await executeReplay(ctx, built, 2000);
    assert.equal(result.status, 200);
    assert.equal(result.statusText, 'OK');
    assert.equal(result.body, '{"ok":true}');
    assert.equal(result.bodyTruncated, false);
    assert.equal(result.replayedUrl, 'https://x.test/y');
    assert.equal(typeof result.timingMs, 'number');
    assert.ok(result.timingMs >= 0);
  });

  it('truncates body when exceeding maxBodyLength', async () => {
    const ctx = createMockApiContext({body: '0123456789'});
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const result = await executeReplay(ctx, built, 5);
    assert.equal(result.body, '01234\n... [truncated]');
    assert.equal(result.bodyTruncated, true);
  });

  it('falls back to empty body when body read fails', async () => {
    const ctx = createMockApiContext({
      status: 200,
      throwOnBody: new Error('body read failed'),
    });
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const result = await executeReplay(ctx, built, 2000);
    assert.equal(result.status, 200);
    assert.equal(result.body, '');
    assert.equal(result.bodyTruncated, false);
  });

  it('propagates fetch errors with original message', async () => {
    const ctx = createMockApiContext({
      throwOnFetch: new Error('network down'),
    });
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {},
    };
    await assert.rejects(executeReplay(ctx, built, 2000), /network down/);
  });
});

describe('formatCurl', () => {
  it('emits GET without -X', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {'X-A': '1'},
    };
    assert.equal(formatCurl(built, {}), "curl 'https://x.test/y' -H 'X-A: 1'");
  });

  it('emits -X POST and --data when body present', () => {
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {'X-A': '1'},
      body: '{"a":1}',
    };
    assert.equal(
      formatCurl(built, {}),
      "curl -X POST 'https://x.test/y' -H 'X-A: 1' --data '{\"a\":1}'",
    );
  });

  it('omits --data when body empty', () => {
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: 'https://x.test/y',
      headers: {},
    };
    assert.equal(formatCurl(built, {}), "curl -X POST 'https://x.test/y'");
  });

  it('escapes single quotes in URL, header values, and body', () => {
    const built: BuiltReplayRequest = {
      method: 'POST',
      url: "https://x.test/it's",
      headers: {'X-Q': "va'lue"},
      body: "{'k':'v'}",
    };
    const curl = formatCurl(built, {});
    assert.ok(curl.includes("'https://x.test/it'\\''s'"));
    assert.ok(curl.includes("-H 'X-Q: va'\\''lue'"));
    assert.ok(curl.includes("--data '{'\\''k'\\'':'\\''v'\\''}'"));
  });

  it('appends Cookie header when includeCookies=true and cookies provided', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const curl = formatCurl(built, {
      includeCookies: true,
      cookies: [
        {name: 'session', value: 'abc'},
        {name: 'csrf', value: 'xyz'},
      ],
    });
    assert.ok(curl.includes("-H 'Cookie: session=abc; csrf=xyz'"));
  });

  it('omits Cookie header when includeCookies=false', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const curl = formatCurl(built, {
      includeCookies: false,
      cookies: [{name: 'session', value: 'abc'}],
    });
    assert.ok(!curl.includes('Cookie'));
  });

  it('omits Cookie header when cookies array empty', () => {
    const built: BuiltReplayRequest = {
      method: 'GET',
      url: 'https://x.test/y',
      headers: {},
    };
    const curl = formatCurl(built, {includeCookies: true, cookies: []});
    assert.ok(!curl.includes('Cookie'));
  });
});
