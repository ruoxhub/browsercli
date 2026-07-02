/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {exportRequestAsCurl} from '../../../../src/tools/network/exportRequestAsCurl.js';

interface TestRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  resourceType(): string;
  headers(): Record<string, string>;
  response(): Promise<{
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  }>;
}

function createMockRequest(): TestRequest {
  return {
    url: () => 'https://api.example.com/v1/sign',
    method: () => 'POST',
    postData: () => '{"foo":"bar"}',
    resourceType: () => 'xhr',
    headers: () => ({
      'X-Sign': 'original-signature',
      'Content-Type': 'application/json',
      Host: 'api.example.com',
    }),
    response: async () => ({
      status: () => 200,
      headers: () => ({}),
    }),
  };
}

function createMockResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (c: unknown) => lines.push(JSON.stringify(c)),
  };
}

function parseResult(r: ReturnType<typeof createMockResponse>): any {
  const jsonLine = r.lines.find(l => l.trim().startsWith('{'));
  if (!jsonLine) throw new Error('No JSON in response');
  return JSON.parse(jsonLine);
}

function createMockContext(
  overrides: {
    cookies?: Array<{name: string; value: string; domain: string}>;
    cookiesThrow?: boolean;
    getRequestById?: (id: number) => unknown;
  } = {},
) {
  const page = {
    context: () => ({
      cookies: async () => {
        if (overrides.cookiesThrow) {
          throw new Error('cookie read failed');
        }
        return overrides.cookies ?? [];
      },
    }),
  };
  return {
    getSelectedPage: () => page,
    getNetworkRequestById:
      overrides.getRequestById ?? (() => createMockRequest()),
  } as any;
}

describe('export_request_as_curl', () => {
  it('exports curl without Cookie header when includeCookies omitted', async () => {
    const ctx = createMockContext();
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'export_request_as_curl');
    assert.equal(result.data.originalReqid, 5);
    assert.equal(result.data.override, null);
    assert.ok(
      result.data.curl.startsWith(
        "curl -X POST 'https://api.example.com/v1/sign'",
      ),
    );
    assert.ok(result.data.curl.includes("-H 'X-Sign: original-signature'"));
    assert.ok(result.data.curl.includes("-H 'Content-Type: application/json'"));
    assert.ok(
      !result.data.curl.includes('Host:'),
      'Host header should be stripped',
    );
    assert.ok(result.data.curl.includes('--data \'{"foo":"bar"}\''));
    assert.ok(!result.data.curl.includes('Cookie'));
  });

  it('exports curl with Cookie header when includeCookies=true and cookies match domain', async () => {
    const ctx = createMockContext({
      cookies: [
        {name: 'session', value: 'abc', domain: 'api.example.com'},
        {name: 'other', value: 'xyz', domain: 'other.test'},
      ],
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.ok(result.data.curl.includes("-H 'Cookie: session=abc'"));
    assert.ok(
      !result.data.curl.includes('xyz'),
      'other.test cookie should be filtered out',
    );
  });

  it('matches cookies on subdomain (api.example.com cookie matches sub.api.example.com URL)', async () => {
    const ctx = createMockContext({
      cookies: [{name: 's', value: 'v', domain: 'api.example.com'}],
      getRequestById: () => ({
        ...createMockRequest(),
        url: () => 'https://sub.api.example.com/v1/sign',
      }),
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.ok(result.data.curl.includes('Cookie: s=v'));
  });

  it('does not match cookies on lookalike domain (example.com cookie does not match evil-example.com)', async () => {
    const ctx = createMockContext({
      cookies: [{name: 's', value: 'v', domain: 'example.com'}],
      getRequestById: () => ({
        ...createMockRequest(),
        url: () => 'https://evil-example.com/v1/sign',
      }),
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.ok(!result.data.curl.includes('Cookie'));
  });

  it('proceeds without cookies and notes failure when cookies() throws', async () => {
    const ctx = createMockContext({cookiesThrow: true});
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 5, includeCookies: true}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.ok(!result.data.curl.includes('Cookie'));
    assert.match(result.message, /Cookie 读取失败/);
  });

  it('returns failure when reqid is invalid', async () => {
    const ctx = createMockContext({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {params: {reqid: 999}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.curl, '');
    assert.equal(result.data.originalReqid, 999);
  });

  it('applies overrides when building the curl command', async () => {
    const ctx = createMockContext();
    const response = createMockResponse();

    await exportRequestAsCurl.handler(
      {
        params: {
          reqid: 5,
          method: 'PUT',
          url: 'https://api.example.com/v2/sign',
          headers: {'X-Test': '1'},
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.ok(
      result.data.curl.startsWith(
        "curl -X PUT 'https://api.example.com/v2/sign'",
      ),
    );
    assert.ok(result.data.curl.includes("-H 'X-Test: 1'"));
    assert.equal(result.data.override.method, 'PUT');
  });
});
