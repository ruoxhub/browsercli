/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {replayNetworkRequestBatch} from '../../../../src/tools/network/replayNetworkRequestBatch.js';

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
    headers: () => ({'X-Sign': 's'}),
    response: async () => ({status: () => 200, headers: () => ({})}),
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

/** Builds a mock context whose page.context().request.fetch returns per-variant statuses. */
function createMockContext(
  opts: {
    statuses?: number[]; // per-variant fetch status; default all 200
    throwOnVariant?: number; // variant index that should throw on fetch
    getRequestById?: (id: number) => unknown;
  } = {},
) {
  let callIdx = -1;
  const fetchCalls: number[] = [];
  const requestObj = {
    fetch: async () => {
      callIdx++;
      fetchCalls.push(callIdx);
      if (opts.throwOnVariant === callIdx) {
        throw new Error(`fetch failed on variant ${callIdx}`);
      }
      const status = opts.statuses?.[callIdx] ?? 200;
      return {
        status: () => status,
        statusText: () => 'OK',
        headers: () => ({}),
        text: async () => `body-${callIdx}`,
      };
    },
  };
  const page = {context: () => ({request: requestObj})};
  return {
    ctx: {
      getSelectedPage: () => page,
      getNetworkRequestById: opts.getRequestById ?? (() => createMockRequest()),
    } as any,
    fetchCalls,
  };
}

describe('replay_network_request_batch', () => {
  it('executes all variants with concurrency=1 and aggregates results', async () => {
    const {ctx, fetchCalls} = createMockContext({statuses: [200, 200, 200]});
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {
        params: {
          reqid: 1,
          variants: [
            {headers: {'X-A': '1'}},
            {headers: {'X-A': '2'}},
            {headers: {'X-A': '3'}},
          ],
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'replay_network_request_batch');
    assert.equal(result.data.total, 3);
    assert.equal(result.data.succeeded, 3);
    assert.equal(result.data.failed, 0);
    assert.deepStrictEqual(result.data.statusCodeDistribution, {200: 3});
    assert.equal(result.data.results.length, 3);
    assert.equal(result.data.results[0].index, 0);
    assert.equal(result.data.results[0].result.body, 'body-0');
    // Sequential: calls happen in order 0,1,2
    assert.deepStrictEqual(fetchCalls, [0, 1, 2]);
  });

  it('marks variant as failed when executeReplay throws, others succeed', async () => {
    const {ctx} = createMockContext({
      statuses: [200, 200, 200],
      throwOnVariant: 1,
    });
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {
        params: {
          reqid: 1,
          variants: [{}, {}, {}],
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.equal(result.data.total, 3);
    assert.equal(result.data.succeeded, 2);
    assert.equal(result.data.failed, 1);
    assert.equal(result.data.results[1].error, 'fetch failed on variant 1');
    assert.equal(result.data.results[1].result.status, 0);
    assert.equal(result.data.results[0].result.status, 200);
    assert.equal(result.data.results[2].result.status, 200);
  });

  it('builds statusCodeDistribution across mixed statuses', async () => {
    const {ctx} = createMockContext({statuses: [200, 500, 200]});
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {params: {reqid: 1, variants: [{}, {}, {}]}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.deepStrictEqual(result.data.statusCodeDistribution, {
      200: 2,
      500: 1,
    });
    assert.equal(result.data.succeeded, 3, 'HTTP 500 is not a failure');
    assert.equal(result.data.failed, 0);
    assert.equal(result.success, true);
  });

  it('executes with concurrency=3 across 5 variants (all complete, no gaps)', async () => {
    const {ctx} = createMockContext({statuses: [200, 200, 200, 200, 200]});
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {
        params: {
          reqid: 1,
          concurrency: 3,
          variants: [{}, {}, {}, {}, {}],
        },
      } as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.data.total, 5);
    assert.equal(result.data.succeeded, 5);
    const indexes = result.data.results
      .map((r: any) => r.index)
      .sort((a: number, b: number) => a - b);
    assert.deepStrictEqual(indexes, [0, 1, 2, 3, 4]);
  });

  it('applies default maxBodyLength=500 when omitted', async () => {
    const {ctx} = createMockContext();
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {params: {reqid: 1, variants: [{}]}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.data.results[0].result.body, 'body-0');
    // body-0 is 6 chars, under 500 — no truncation
    assert.equal(result.data.results[0].result.bodyTruncated, false);
  });

  it('returns failure aggregate when reqid is invalid', async () => {
    const {ctx} = createMockContext({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });
    const response = createMockResponse();

    await replayNetworkRequestBatch.handler(
      {params: {reqid: 999, variants: [{}, {}]}} as any,
      response as any,
      ctx,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.total, 2);
    assert.equal(result.data.succeeded, 0);
    assert.equal(result.data.failed, 2);
    assert.deepStrictEqual(result.data.results, []);
  });
});
