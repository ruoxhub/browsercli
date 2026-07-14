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
    headers: () => ({'X-Sign': 's'}),
    response: async () => ({status: () => 200, headers: () => ({})}),
  };
}

/** Builds a mock NetworkServices whose page.context().request.fetch returns per-variant statuses. */
function createMockServices(
  opts: {
    statuses?: number[]; // per-variant fetch status; default all 200
    throwOnVariant?: number; // variant index that should throw on fetch
    getRequestById?: (id: number) => unknown;
  } = {},
): {services: NetworkServices; fetchCalls: number[]} {
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
  const services = {
    getPages: () => [page as any],
    getSelectedPage: () => page as any,
    getNetworkRequests: () => [],
    getNetworkRequestById:
      opts.getRequestById ?? (() => createMockRequest() as any),
    getNetworkRequestStableId: () => 1,
    getRequestInitiator: () => undefined,
    clearNetworkRequests: () => {},
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
  return {services, fetchCalls};
}

describe('replay_network_request_batch', () => {
  const networkModule = new NetworkModule();

  it('executes all variants with concurrency=1 and aggregates results', async () => {
    const {services, fetchCalls} = createMockServices({
      statuses: [200, 200, 200],
    });

    const result = await networkModule.replayBatch(services, {
      reqid: 1,
      variants: [
        {headers: {'X-A': '1'}},
        {headers: {'X-A': '2'}},
        {headers: {'X-A': '3'}},
      ],
    });

    assert.equal(result.success, true);
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
    const {services} = createMockServices({
      statuses: [200, 200, 200],
      throwOnVariant: 1,
    });

    const result = await networkModule.replayBatch(services, {
      reqid: 1,
      variants: [{}, {}, {}],
    });

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
    const {services} = createMockServices({statuses: [200, 500, 200]});

    const result = await networkModule.replayBatch(services, {
      reqid: 1,
      variants: [{}, {}, {}],
    });

    assert.deepStrictEqual(result.data.statusCodeDistribution, {
      200: 2,
      500: 1,
    });
    assert.equal(result.data.succeeded, 3, 'HTTP 500 is not a failure');
    assert.equal(result.data.failed, 0);
    assert.equal(result.success, true);
  });

  it('executes with concurrency=3 across 5 variants (all complete, no gaps)', async () => {
    const {services} = createMockServices({
      statuses: [200, 200, 200, 200, 200],
    });

    const result = await networkModule.replayBatch(services, {
      reqid: 1,
      concurrency: 3,
      variants: [{}, {}, {}, {}, {}],
    });

    assert.equal(result.data.total, 5);
    assert.equal(result.data.succeeded, 5);
    const indexes = result.data.results
      .map((r: any) => r.index)
      .sort((a: number, b: number) => a - b);
    assert.deepStrictEqual(indexes, [0, 1, 2, 3, 4]);
  });

  it('applies default maxBodyLength=500 when omitted', async () => {
    const {services} = createMockServices();

    const result = await networkModule.replayBatch(services, {
      reqid: 1,
      variants: [{}],
    });

    assert.equal(result.data.results[0].result.body, 'body-0');
    // body-0 is 6 chars, under 500 — no truncation
    assert.equal(result.data.results[0].result.bodyTruncated, false);
  });

  it('returns failure aggregate when reqid is invalid', async () => {
    const {services} = createMockServices({
      getRequestById: () => {
        throw new Error('reqid not found');
      },
    });

    const result = await networkModule.replayBatch(services, {
      reqid: 999,
      variants: [{}, {}],
    });

    assert.equal(result.success, false);
    assert.match(result.message, /reqid not found/);
    assert.equal(result.data.total, 2);
    assert.equal(result.data.succeeded, 0);
    assert.equal(result.data.failed, 2);
    assert.deepStrictEqual(result.data.results, []);
  });
});
