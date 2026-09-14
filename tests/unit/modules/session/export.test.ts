/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {
  buildCurlScript,
  buildHar,
  buildJson,
  desensitizeHeaders,
  exportTraffic,
  isSensitiveHeader,
  parseJsonHeaders,
} from '../../../../src/modules/session/export.js';
import type {CapturedRequestRow} from '../../../../src/modules/session/types.js';
import {resolvePackageRoot} from '../../../../src/utils/projectPaths.js';

interface HarEntry {
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{name: string; value: string}>;
    queryString: Array<{name: string; value: string}>;
    cookies: Array<{name: string; value: string}>;
    postData?: {mimeType: string; text: string};
  };
  response: {
    status: number;
    statusText: string;
    content: {mimeType: string; size: number; text?: string};
    cookies: Array<{name: string; value: string}>;
    redirectURL: string;
  };
  _source?: string;
  _initiator?: string;
}

interface HarOutput {
  log: {
    version: string;
    creator: {name: string; version: string};
    entries: HarEntry[];
  };
}

interface JsonExportOutput {
  version: string;
  creator: string;
  total: number;
  requests: Array<{
    id: string;
    method: string;
    requestHeaders: Record<string, string>;
    responseBody: string | null;
  }>;
}

function makeMockRequest(
  id: string,
  overrides: Partial<CapturedRequestRow> = {},
): CapturedRequestRow {
  return {
    id,
    sessionId: 'session-123',
    sequence: 1,
    timestamp: 1789357819000,
    method: 'POST',
    url: 'https://api.example.com/v1/login?source=web&debug=1',
    source: 'proxy',
    requestHeaders: JSON.stringify({
      'content-type': 'application/json',
      authorization: 'Bearer secret-token-123',
      cookie: 'session_id=abc456; theme=dark',
      'user-agent': 'Mozilla/5.0',
    }),
    requestBody: JSON.stringify({username: 'tester', password: 'password123'}),
    statusCode: 200,
    responseHeaders: JSON.stringify({
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'refresh_token=xyz789; Path=/; HttpOnly',
      'x-request-id': 'req-999',
    }),
    responseBody: JSON.stringify({token: 'new-token', status: 'ok'}),
    contentType: 'application/json',
    initiator: 'TRAE SOLO CN.exe',
    durationMs: 45,
    isStreaming: 0,
    isWebSocket: 0,
    truncated: 0,
    ...overrides,
  };
}

describe('session export module', () => {
  it('detects sensitive headers accurately', () => {
    assert.strictEqual(isSensitiveHeader('Authorization'), true);
    assert.strictEqual(isSensitiveHeader('authorization'), true);
    assert.strictEqual(isSensitiveHeader('cookie'), true);
    assert.strictEqual(isSensitiveHeader('Set-Cookie'), true);
    assert.strictEqual(isSensitiveHeader('x-auth-token'), true);
    assert.strictEqual(isSensitiveHeader('x-api-key'), true);
    assert.strictEqual(isSensitiveHeader('my_secret_token'), true);
    assert.strictEqual(isSensitiveHeader('Content-Type'), false);
    assert.strictEqual(isSensitiveHeader('Accept'), false);
    assert.strictEqual(isSensitiveHeader('Host'), false);
  });

  it('desensitizes headers correctly', () => {
    const raw = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test',
      Cookie: 'a=1; b=2',
      'X-Request-Id': '123',
    };
    const masked = desensitizeHeaders(raw);
    assert.strictEqual(masked['Content-Type'], 'application/json');
    assert.strictEqual(masked['X-Request-Id'], '123');
    assert.strictEqual(masked['Authorization'], '[REDACTED]');
    assert.strictEqual(masked['Cookie'], '[REDACTED]');
  });

  it('parses JSON headers safely', () => {
    assert.deepStrictEqual(parseJsonHeaders(null), {});
    assert.deepStrictEqual(parseJsonHeaders(''), {});
    assert.deepStrictEqual(parseJsonHeaders('invalid json'), {});
    assert.deepStrictEqual(parseJsonHeaders('{"a": "1", "b": 2}'), {
      a: '1',
      b: '2',
    });
  });

  it('builds valid HAR 1.2 structure', () => {
    const req = makeMockRequest('r-1');
    const har = buildHar([req]) as unknown as HarOutput;

    assert.strictEqual(har.log.version, '1.2');
    assert.strictEqual(har.log.creator.name, 'JSReverser');
    // 版本号从 package.json 读取，避免发版后失同步
    const pkg = JSON.parse(
      readFileSync(
        join(resolvePackageRoot(import.meta.url), 'package.json'),
        'utf-8',
      ),
    ) as {version: string};
    assert.strictEqual(har.log.creator.version, pkg.version);
    assert.strictEqual(har.log.entries.length, 1);

    const entry = har.log.entries[0]!;
    assert.strictEqual(entry.time, 45);
    assert.strictEqual(entry.request.method, 'POST');
    assert.strictEqual(
      entry.request.url,
      'https://api.example.com/v1/login?source=web&debug=1',
    );
    assert.strictEqual(entry.request.httpVersion, 'HTTP/1.1');

    // Query string in HAR
    assert.ok(
      entry.request.queryString.some(
        q => q.name === 'source' && q.value === 'web',
      ),
    );
    assert.ok(
      entry.request.queryString.some(
        q => q.name === 'debug' && q.value === '1',
      ),
    );

    // Cookies in HAR
    assert.ok(
      entry.request.cookies.some(
        c => c.name === 'session_id' && c.value === 'abc456',
      ),
    );

    // postData
    assert.strictEqual(entry.request.postData?.mimeType, 'application/json');
    assert.ok(entry.request.postData?.text.includes('tester'));

    // Response
    assert.strictEqual(entry.response.status, 200);
    assert.strictEqual(entry.response.statusText, 'OK');
    assert.strictEqual(entry.response.content.mimeType, 'application/json');
    assert.ok(entry.response.content.text?.includes('new-token'));

    // Source & initiator
    assert.strictEqual(entry._source, 'proxy');
    assert.strictEqual(entry._initiator, 'TRAE SOLO CN.exe');
  });

  it('handles HAR export with desensitization enabled', () => {
    const req = makeMockRequest('r-1');
    const har = buildHar([req], {desensitize: true}) as unknown as HarOutput;
    const entry = har.log.entries[0]!;

    const authHeader = entry.request.headers.find(
      h => h.name.toLowerCase() === 'authorization',
    );
    assert.strictEqual(authHeader?.value, '[REDACTED]');

    const cookieHeader = entry.request.headers.find(
      h => h.name.toLowerCase() === 'cookie',
    );
    assert.strictEqual(cookieHeader?.value, '[REDACTED]');

    const parsedCookie = entry.request.cookies.find(
      c => c.name === 'session_id',
    );
    assert.strictEqual(parsedCookie?.value, '[REDACTED]');
  });

  it('parses Set-Cookie into a single cookie ignoring attributes', () => {
    const req = makeMockRequest('r-1');
    const har = buildHar([req]) as unknown as HarOutput;
    const entry = har.log.entries[0]!;

    assert.deepStrictEqual(entry.response.cookies, [
      {name: 'refresh_token', value: 'xyz789'},
    ]);
    assert.ok(!entry.response.cookies.some(c => c.name === 'Path'));
    assert.ok(!entry.response.cookies.some(c => c.name === 'HttpOnly'));
  });

  it('looks up headers case-insensitively for cookies and redirect', () => {
    const req = makeMockRequest('r-1', {
      requestHeaders: JSON.stringify({Cookie: 'a=1; b=2'}),
      responseHeaders: JSON.stringify({
        'Set-Cookie': 'sid=zzz; Path=/',
        Location: 'https://api.example.com/next',
      }),
    });
    const har = buildHar([req]) as unknown as HarOutput;
    const entry = har.log.entries[0]!;

    assert.deepStrictEqual(entry.request.cookies, [
      {name: 'a', value: '1'},
      {name: 'b', value: '2'},
    ]);
    assert.deepStrictEqual(entry.response.cookies, [
      {name: 'sid', value: 'zzz'},
    ]);
    assert.strictEqual(
      entry.response.redirectURL,
      'https://api.example.com/next',
    );
  });

  it('handles HAR export with includeResponseBody: false', () => {
    const req = makeMockRequest('r-1');
    const har = buildHar([req], {
      includeResponseBody: false,
    }) as unknown as HarOutput;
    const entry = har.log.entries[0]!;

    assert.strictEqual(entry.response.content.text, undefined);
    assert.ok(entry.response.content.size > 0);
  });

  it('builds structured JSON export', () => {
    const req = makeMockRequest('r-1');
    const result = buildJson([req]) as unknown as JsonExportOutput;

    assert.strictEqual(result.version, '1.0');
    assert.strictEqual(result.creator, 'JSReverser');
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.requests[0]?.id, 'r-1');
    assert.strictEqual(result.requests[0]?.method, 'POST');
    assert.strictEqual(
      result.requests[0]?.requestHeaders['content-type'],
      'application/json',
    );
    assert.ok(result.requests[0]?.responseBody?.includes('new-token'));
  });

  it('builds cURL script export', () => {
    const req = makeMockRequest('r-1');
    const script = buildCurlScript([req]);

    assert.ok(script.startsWith('#!/usr/bin/env bash'));
    assert.ok(
      script.includes("curl -X POST 'https://api.example.com/v1/login"),
    );
    assert.ok(script.includes("-H 'content-type: application/json'"));
    assert.ok(script.includes('--data-raw \'{"username":"tester"'));
  });

  it('exportTraffic generates expected formats and metadata', () => {
    const req = makeMockRequest('r-1');

    const harRes = exportTraffic([req], 'har');
    assert.strictEqual(harRes.mimeType, 'application/json; charset=utf-8');
    assert.ok(harRes.filename.endsWith('.har'));
    assert.strictEqual(harRes.count, 1);
    const parsedHar = JSON.parse(harRes.content);
    assert.strictEqual(parsedHar.log.version, '1.2');

    const jsonRes = exportTraffic([req], 'json');
    assert.strictEqual(jsonRes.mimeType, 'application/json; charset=utf-8');
    assert.ok(jsonRes.filename.endsWith('.json'));
    assert.strictEqual(jsonRes.count, 1);

    const curlRes = exportTraffic([req], 'curl');
    assert.strictEqual(curlRes.mimeType, 'application/x-sh; charset=utf-8');
    assert.ok(curlRes.filename.endsWith('.sh'));
    assert.strictEqual(curlRes.count, 1);
  });
});
