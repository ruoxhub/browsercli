/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {listNetworkRequests} from '../../../../src/tools/network/listNetworkRequests.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../../../../src/tools/shared/activePageResolver.js';

interface TestRequest {
  url(): string;
  method(): string;
  postData(): string | null;
  resourceType(): string;
  headers(): Record<string, string>;
}

function createRequest(
  url: string,
  headers: Record<string, string> = {},
): TestRequest {
  return {
    url: () => url,
    method: () => 'GET',
    postData: () => null,
    resourceType: () => 'xhr',
    headers: () => headers,
  };
}

describe('listNetworkRequests', () => {
  it('uses selected page index when targetPageIdx is omitted', async () => {
    const pages = [{id: 0}, {id: 1}, {id: 2}, {id: 3}, {id: 4}];
    const selectedPage = pages[4];
    const request = createRequest('https://example.test/api');

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 4,
        getNetworkRequests: () => [request as never],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => 101,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {},
    );

    assert.equal(result.success, true);
    assert.equal(result.data.pageIdx, 0);
    assert.equal(result.data.targetPageIdx, 4);
    assert.equal(result.data.requests[0]?.reqid, 101);
  });

  it('uses targetPageIdx for browser page selection', async () => {
    const requestedPageIndexes: Array<number | undefined> = [];

    const result = await listNetworkRequests(
      {
        getPages: () => [],
        getSelectedPage: () => null,
        getSelectedPageIndex: () => null,
        getNetworkRequests: (_includePreserved, pageIdx) => {
          requestedPageIndexes.push(pageIdx);
          return [createRequest('https://example.test/target-page') as never];
        },
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => 111,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {targetPageIdx: 3},
    );

    assert.equal(result.success, true);
    assert.deepStrictEqual(requestedPageIndexes, [3]);
    assert.equal(result.data.targetPageIdx, 3);
  });

  it('paginates requests using pageIdx as result page number', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const firstRequest = createRequest('https://example.test/request-1');
    const secondRequest = createRequest('https://example.test/request-2');

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 0,
        getNetworkRequests: () => [firstRequest, secondRequest] as never[],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: request =>
          request === (firstRequest as never) ? 201 : 202,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {pageSize: 1, pageIdx: 1},
    );

    assert.equal(result.success, true);
    assert.equal(result.data.pageIdx, 1);
    assert.equal(result.data.targetPageIdx, 0);
    assert.equal(result.data.requests.length, 1);
    assert.equal(
      result.data.requests[0]?.url,
      'https://example.test/request-2',
    );
  });

  it('returns actionable message when no active page is available', async () => {
    const result = await listNetworkRequests(
      {
        getPages: () => [],
        getSelectedPage: () => null,
        getSelectedPageIndex: () => null,
        getNetworkRequests: () => {
          throw new Error('should not fetch requests without active page');
        },
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => -1,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {},
    );

    assert.equal(result.success, false);
    assert.match(result.message, /new_page/);
    assert.match(result.message, /select_page/);
  });

  it('fails when selected page exists but active page index cannot be resolved', async () => {
    const selectedPage = {id: 99};

    const result = await listNetworkRequests(
      {
        getPages: () => [],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => null,
        getNetworkRequests: () => {
          throw new Error(
            'should not fetch requests without a resolved page index',
          );
        },
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => -1,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {},
    );

    assert.equal(result.success, false);
    assert.equal(result.message, NO_ACTIVE_PAGE_MESSAGE);
  });

  it('waits for matching request before returning', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const delayedRequest = createRequest('https://example.test/api/v4/feed');
    let currentRequests: TestRequest[] = [];

    setTimeout(() => {
      currentRequests = [delayedRequest];
    }, 20);

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 0,
        getNetworkRequests: () => currentRequests as never[],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => 202,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {waitForRequest: '/api/v4', waitTimeoutMs: 150},
    );

    assert.equal(result.success, true);
    assert.equal(result.data.requests.length, 1);
    assert.equal(
      result.data.requests[0]?.url,
      'https://example.test/api/v4/feed',
    );
  });

  it('returns timeout failure immediately when waitTimeoutMs is 0', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const start = Date.now();

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 0,
        getNetworkRequests: () => [] as never[],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => 0,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {waitForRequest: '/never', waitTimeoutMs: 0},
    );

    const durationMs = Date.now() - start;
    assert.equal(result.success, false);
    assert.match(result.message, /等待请求超时/);
    assert.equal(result.data.timedOut, true);
    assert.ok(
      durationMs < 40,
      `expected immediate timeout, got ${durationMs}ms`,
    );
  });

  it('returns explicit timeout failure when no matching request arrives', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 0,
        getNetworkRequests: () =>
          [createRequest('https://example.test/other')] as never[],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => 401,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {waitForRequest: '/missing', waitTimeoutMs: 30},
    );

    assert.equal(result.success, false);
    assert.match(result.message, /等待请求超时/);
    assert.equal(result.data.timedOut, true);
    assert.equal(result.data.requests.length, 0);
  });

  it('filters requests by header keyword', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const zhihuRequest = createRequest('https://www.zhihu.com/api/v4/feed', {
      'x-zse-96': '2.0_abcdef',
      accept: 'application/json',
    });
    const otherRequest = createRequest('https://www.zhihu.com/api/v4/hot', {
      accept: 'application/json',
    });

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 0,
        getNetworkRequests: () => [zhihuRequest, otherRequest] as never[],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: request =>
          request === (zhihuRequest as never) ? 301 : 302,
        getRequestInitiator: () => undefined,
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {headerFilter: 'x-zse-96'},
    );

    assert.equal(result.success, true);
    assert.equal(result.data.requests.length, 1);
    assert.equal(
      result.data.requests[0]?.url,
      'https://www.zhihu.com/api/v4/feed',
    );
  });

  it('can include signature evidence correlation for filtered requests', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const signedRequest = createRequest('https://example.test/api/order', {
      'x-sign': 'abc123',
      'x-nonce': 'n-1',
      accept: 'application/json',
    });

    const result = await listNetworkRequests(
      {
        getPages: () => pages as never[],
        getSelectedPage: () => selectedPage as never,
        getSelectedPageIndex: () => 0,
        getNetworkRequests: () => [signedRequest] as never[],
        getNetworkRequestById: () => {
          throw new Error('unused');
        },
        getNetworkRequestStableId: () => 501,
        getRequestInitiator: () => ({
          type: 'script',
          url: 'https://example.test/app.js',
          lineNumber: 12,
          columnNumber: 3,
        }),
        getDevToolsData: async () => undefined,
        resolveCdpRequestId: () => undefined,
      },
      {
        headerFilter: 'sign',
        includeSignatureEvidence: true,
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.data.requests.length, 1);
    assert.deepEqual(result.data.evidenceCorrelations, [
      {
        reqid: 501,
        signatureIndicators: ['x-sign', 'x-nonce'],
        initiator: {
          type: 'script',
          url: 'https://example.test/app.js',
          lineNumber: 12,
          columnNumber: 3,
        },
        nextSteps: [
          '调用 get_request_initiator 查看完整调用栈',
          '调用 xhr_to_js_breakpoint 在请求发送前暂停',
          '暂停后调用 get_paused_info 和 evaluate_on_callframe 查看局部变量',
        ],
      },
    ]);
  });
});
