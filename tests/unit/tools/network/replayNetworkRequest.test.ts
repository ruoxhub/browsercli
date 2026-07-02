/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {replayNetworkRequest} from '../../../../src/tools/network/replayNetworkRequest.js';

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
    url: () => 'https://x.test/y',
    method: () => 'POST',
    postData: () => '{"foo":"bar"}',
    resourceType: () => 'xhr',
    headers: () => ({
      'X-Sign': 'original-signature',
      'Content-Type': 'application/json',
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

interface MockApiContext {
  fetch: (url: string, opts: any) => Promise<any>;
}

function createMockApiContext(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  throwOnFetch?: Error;
  captureFetch?: (url: string, opts: any) => void;
}): MockApiContext {
  return {
    fetch: async (url, fetchOpts) => {
      opts.captureFetch?.(url, fetchOpts);
      if (opts.throwOnFetch) {
        throw opts.throwOnFetch;
      }
      return {
        status: () => opts.status ?? 200,
        statusText: () => opts.statusText ?? 'OK',
        headers: () => opts.headers ?? {'content-type': 'application/json'},
        text: async () => opts.body ?? '{"ok":true}',
      };
    },
  };
}

function createMockContext(
  overrides: {
    apiCtx?: MockApiContext;
    getRequestById?: (id: number) => unknown;
  } = {},
) {
  const defaultApiCtx = createMockApiContext({});
  const page = {
    context: () => ({request: overrides.apiCtx ?? defaultApiCtx}),
  };
  return {
    getSelectedPage: () => page,
    getNetworkRequestById:
      overrides.getRequestById ?? (() => createMockRequest()),
  } as any;
}

describe('replay_network_request', () => {
  it('returns success and echoes override on happy path', async () => {
    const apiCtx = createMockApiContext({
      status: 200,
      statusText: 'OK',
      body: '{"ok":true}',
      headers: {'content-type': 'application/json'},
    });
    const ctx = createMockContext({apiCtx});
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 5, headers: {'X-Test': '1'}}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'replay_network_request');
    assert.equal(result.data.status, 200);
    assert.equal(result.data.originalReqid, 5);
    assert.equal(result.data.body, '{"ok":true}');
    assert.equal(result.data.headers['content-type'], 'application/json');
    assert.equal(result.data.override.headers['X-Test'], '1');
    assert.match(result.message, /200/);
  });

  it('returns failure when reqid is invalid (getNetworkRequestById throws)', async () => {
    const ctx = createMockContext({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 999}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.originalReqid, 999);
    assert.equal(result.data.status, 0);
  });

  it('returns failure when executeReplay throws (fetch rejects)', async () => {
    const apiCtx = createMockApiContext({
      throwOnFetch: new Error('network down'),
    });
    const ctx = createMockContext({apiCtx});
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 1}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /network down/);
  });

  it('passes override to buildReplayRequest (override method/url reach fetch)', async () => {
    let capturedOpts: any;
    const apiCtx = createMockApiContext({
      captureFetch: (_url, opts) => {
        capturedOpts = opts;
      },
    });
    const ctx = createMockContext({apiCtx});

    await replayNetworkRequest.handler(
      {params: {reqid: 7, method: 'PUT', url: 'https://z.test/w'}} as any,
      createMockResponse() as any,
      ctx,
    );

    assert.equal(capturedOpts.method, 'PUT');
    // url is passed as the first arg to fetch
    // (verified by captureFetch signature — the request url override is 'https://z.test/w')
  });

  it('uses overridden URL when fetching', async () => {
    let capturedUrl = '';
    const apiCtx = createMockApiContext({
      captureFetch: url => {
        capturedUrl = url;
      },
    });
    const ctx = createMockContext({apiCtx});

    await replayNetworkRequest.handler(
      {params: {reqid: 7, url: 'https://z.test/w'}} as any,
      createMockResponse() as any,
      ctx,
    );

    assert.equal(capturedUrl, 'https://z.test/w');
  });

  it('applies default maxBodyLength=2000 when omitted', async () => {
    let capturedBody = '';
    const apiCtx = createMockApiContext({
      body: 'x'.repeat(2500),
      captureFetch: (_url, _opts) => {},
    });
    const ctx = createMockContext({apiCtx});
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 1}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    // 2000 chars + truncation suffix
    assert.equal(result.data.body.length, 2000 + '\n... [truncated]'.length);
    assert.equal(result.data.bodyTruncated, true);
  });

  it('applies custom maxBodyLength when provided', async () => {
    const apiCtx = createMockApiContext({
      body: 'x'.repeat(600),
    });
    const ctx = createMockContext({apiCtx});
    const response = createMockResponse();

    await replayNetworkRequest.handler(
      {params: {reqid: 1, maxBodyLength: 500}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.data.bodyTruncated, true);
    assert.equal(result.data.body.length, 500 + '\n... [truncated]'.length);
  });

  it('strips managed headers (Host, Content-Length) before fetch', async () => {
    let capturedOpts: any;
    const apiCtx = createMockApiContext({
      captureFetch: (_url, opts) => {
        capturedOpts = opts;
      },
    });
    const ctx = createMockContext({
      apiCtx,
      getRequestById: () => ({
        ...createMockRequest(),
        headers: () => ({
          'X-Sign': 'keep-me',
          Host: 'should-be-stripped',
          'Content-Length': '42',
        }),
      }),
    });

    await replayNetworkRequest.handler(
      {params: {reqid: 1}} as any,
      createMockResponse() as any,
      ctx,
    );

    assert.equal(capturedOpts.headers['X-Sign'], 'keep-me');
    assert.equal(capturedOpts.headers['Host'], undefined);
    assert.equal(capturedOpts.headers['Content-Length'], undefined);
  });
});
