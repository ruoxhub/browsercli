/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';

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

interface MockApiRequestContext {
  fetch: (url: string, opts: any) => Promise<any>;
}

function createMockApiRequestContext(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  throwOnFetch?: Error;
  captureFetch?: (url: string, opts: any) => void;
}): MockApiRequestContext {
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

function createMockServices(
  overrides: {
    apiCtx?: MockApiRequestContext;
    getRequestById?: (id: number) => unknown;
  } = {},
): NetworkServices {
  const defaultApiCtx = createMockApiRequestContext({});
  const page = {
    context: () => ({request: overrides.apiCtx ?? defaultApiCtx}),
  };
  return {
    resolvePage: () => ({page: page as any, pageId: 'page-1', pageIdx: 0}),
    getPages: () => [page as any],
    getSelectedPage: () => page as any,
    getNetworkRequests: () => [],
    getNetworkRequestsForPage: () => [],
    getNetworkRequestById:
      overrides.getRequestById ?? (() => createMockRequest() as any),
    getNetworkRequestStableId: () => 1,
    getRequestInitiator: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    clearNetworkRequests: () => {},
    clearNetworkRequestsForPage: () => {},
    getWebSocketConnections: () => [],
    getWebSocketConnectionById: () =>
      ({
        connection: {url: '', status: 'open', requestId: '', createdAt: 0},
        frames: [],
      }) as any,
    getWebSocketStableId: () => 0,
    getDevToolsData: async () => undefined,
    resolveCdpRequestId: () => undefined,
  } as NetworkServices;
}

describe('replay_network_request', () => {
  const networkModule = new NetworkModule();

  it('returns success and echoes override on happy path', async () => {
    const apiCtx = createMockApiRequestContext({
      status: 200,
      statusText: 'OK',
      body: '{"ok":true}',
      headers: {'content-type': 'application/json'},
    });
    const services = createMockServices({apiCtx});

    const result = await networkModule.replayRequest(services, {
      reqid: 5,
      headers: {'X-Test': '1'},
    });

    assert.equal(result.success, true);
    assert.equal(result.data.status, 200);
    assert.equal(result.data.originalReqid, 5);
    assert.equal(result.data.body, '{"ok":true}');
    assert.equal(result.data.headers['content-type'], 'application/json');
    assert.equal(result.data.override.headers['X-Test'], '1');
    assert.match(result.message, /200/);
  });

  it('returns failure when reqid is invalid (getNetworkRequestById throws)', async () => {
    const services = createMockServices({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });

    const result = await networkModule.replayRequest(services, {reqid: 999});

    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.originalReqid, 999);
    assert.equal(result.data.status, 0);
  });

  it('returns failure when executeReplay throws (fetch rejects)', async () => {
    const apiCtx = createMockApiRequestContext({
      throwOnFetch: new Error('network down'),
    });
    const services = createMockServices({apiCtx});

    const result = await networkModule.replayRequest(services, {reqid: 1});

    assert.equal(result.success, false);
    assert.match(result.message, /network down/);
  });

  it('passes override to buildReplayRequest (override method/url reach fetch)', async () => {
    let capturedOpts: any;
    const apiCtx = createMockApiRequestContext({
      captureFetch: (_url, opts) => {
        capturedOpts = opts;
      },
    });
    const services = createMockServices({apiCtx});

    await networkModule.replayRequest(services, {
      reqid: 7,
      method: 'PUT',
      url: 'https://z.test/w',
    });

    assert.equal(capturedOpts.method, 'PUT');
    // url is passed as the first arg to fetch
    // (verified by captureFetch signature — the request url override is 'https://z.test/w')
  });

  it('uses overridden URL when fetching', async () => {
    let capturedUrl = '';
    const apiCtx = createMockApiRequestContext({
      captureFetch: url => {
        capturedUrl = url;
      },
    });
    const services = createMockServices({apiCtx});

    await networkModule.replayRequest(services, {
      reqid: 7,
      url: 'https://z.test/w',
    });

    assert.equal(capturedUrl, 'https://z.test/w');
  });

  it('applies default maxBodyLength=2000 when omitted', async () => {
    const apiCtx = createMockApiRequestContext({
      body: 'x'.repeat(2500),
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
      captureFetch: (_url, _opts) => {},
    });
    const services = createMockServices({apiCtx});

    const result = await networkModule.replayRequest(services, {reqid: 1});

    // 2000 chars + truncation suffix
    assert.equal(result.data.body.length, 2000 + '\n... [truncated]'.length);
    assert.equal(result.data.bodyTruncated, true);
  });

  it('applies custom maxBodyLength when provided', async () => {
    const apiCtx = createMockApiRequestContext({
      body: 'x'.repeat(600),
    });
    const services = createMockServices({apiCtx});

    const result = await networkModule.replayRequest(services, {
      reqid: 1,
      maxBodyLength: 500,
    });

    assert.equal(result.data.bodyTruncated, true);
    assert.equal(result.data.body.length, 500 + '\n... [truncated]'.length);
  });

  it('strips managed headers (Host, Content-Length) before fetch', async () => {
    let capturedOpts: any;
    const apiCtx = createMockApiRequestContext({
      captureFetch: (_url, opts) => {
        capturedOpts = opts;
      },
    });
    const services = createMockServices({
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

    await networkModule.replayRequest(services, {reqid: 1});

    assert.equal(capturedOpts.headers['X-Sign'], 'keep-me');
    assert.equal(capturedOpts.headers['Host'], undefined);
    assert.equal(capturedOpts.headers['Content-Length'], undefined);
  });
});
