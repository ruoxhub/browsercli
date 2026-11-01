/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {NetworkModule} from '../../../../src/modules/network/NetworkModule.js';
import type {NetworkServices} from '../../../../src/modules/network/NetworkTypes.js';
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

function createMockServices(services: {
  resolvePage?: (selector: {
    pageId?: string;
    pageIdx?: number;
    fallbackToSelected?: boolean;
  }) => {page: unknown; pageId: string; pageIdx: number};
  getPages?: () => unknown[];
  getSelectedPage?: () => unknown | null;
  getSelectedPageIndex?: () => number | null;
  getNetworkRequests?: (
    includePreserved?: boolean,
    pageIdx?: number,
  ) => unknown[];
  getNetworkRequestsForPage?: (
    page: unknown,
    includePreserved?: boolean,
  ) => unknown[];
  getNetworkRequestById?: (reqid: number) => unknown;
  getNetworkRequestStableId?: (request: unknown) => number;
  getRequestInitiator?: (request: unknown) => unknown;
  getDevToolsData?: () => Promise<unknown>;
  resolveCdpRequestId?: (cdpRequestId: string) => number | undefined;
}): NetworkServices {
  return {
    resolvePage:
      services.resolvePage ??
      (selector => {
        const pages = services.getPages?.() ?? [];
        const pageIdx =
          selector.pageIdx ??
          services.getSelectedPageIndex?.() ??
          pages.indexOf(services.getSelectedPage?.());
        const page = pages[pageIdx];
        if (!page) throw new Error(NO_ACTIVE_PAGE_MESSAGE);
        return {page, pageId: `page-${pageIdx + 1}`, pageIdx};
      }),
    getPages: services.getPages ?? (() => []),
    getSelectedPage: services.getSelectedPage ?? (() => null),
    getSelectedPageIndex: services.getSelectedPageIndex,
    getNetworkRequests: services.getNetworkRequests ?? (() => []),
    getNetworkRequestsForPage:
      services.getNetworkRequestsForPage ??
      ((page, includePreserved) => {
        const pages = services.getPages?.() ?? [];
        return (
          services.getNetworkRequests?.(
            includePreserved,
            pages.indexOf(page),
          ) ?? []
        );
      }),
    getNetworkRequestById:
      services.getNetworkRequestById ?? (() => ({}) as any),
    getNetworkRequestStableId: services.getNetworkRequestStableId ?? (() => 0),
    getRequestInitiator: services.getRequestInitiator ?? (() => undefined),
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    clearNetworkRequests: () => {},
    clearNetworkRequestsForPage: () => undefined,
    getWebSocketConnections: () => [],
    getWebSocketConnectionById: () =>
      ({
        connection: {url: '', status: 'open', requestId: '', createdAt: 0},
        frames: [],
      }) as any,
    getWebSocketStableId: () => 0,
    getDevToolsData: services.getDevToolsData ?? (async () => undefined),
    resolveCdpRequestId: services.resolveCdpRequestId ?? (() => undefined),
  } as NetworkServices;
}

describe('listNetworkRequests', () => {
  const networkModule = new NetworkModule();

  it('uses selected page index when targetPageIdx is omitted', async () => {
    const pages = [{id: 0}, {id: 1}, {id: 2}, {id: 3}, {id: 4}];
    const selectedPage = pages[4];
    const request = createRequest('https://example.test/api');

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {});

    assert.equal(result.success, true);
    assert.equal(result.data.pageIdx, 0);
    assert.equal(result.data.targetPageIdx, 4);
    assert.equal(result.data.requests[0]?.reqid, 101);
  });

  it('uses targetPageIdx for browser page selection', async () => {
    const requestedPageIndexes: Array<number | undefined> = [];
    const pages = [{id: 0}, {id: 1}, {id: 2}, {id: 3}];

    const services = createMockServices({
      getPages: () => pages,
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
    });

    const result = await networkModule.listRequests(services, {
      targetPageIdx: 3,
    });

    assert.equal(result.success, true);
    assert.deepStrictEqual(requestedPageIndexes, [3]);
    assert.equal(result.data.targetPageIdx, 3);
  });

  it('paginates requests using pageIdx as result page number', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const firstRequest = createRequest('https://example.test/request-1');
    const secondRequest = createRequest('https://example.test/request-2');

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      pageSize: 1,
      pageIdx: 1,
    });

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
    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {});

    assert.equal(result.success, false);
    assert.match(result.message || '', /new_page/);
    assert.match(result.message || '', /select_page/);
  });

  it('fails when selected page exists but active page index cannot be resolved', async () => {
    const selectedPage = {id: 99};

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {});

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

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      waitForRequest: '/api/v4',
      waitTimeoutMs: 150,
    });

    assert.equal(result.success, true);
    assert.equal(result.data.requests.length, 1);
    assert.equal(
      result.data.requests[0]?.url,
      'https://example.test/api/v4/feed',
    );
  });

  it('pins the resolved Page while waiting even if page order changes', async () => {
    const firstPage = {id: 'first'};
    const targetPage = {id: 'target'};
    const matchingRequest = createRequest('https://example.test/pinned');
    let pages = [firstPage, targetPage];
    let reads = 0;
    const services = createMockServices({
      getPages: () => pages,
      resolvePage: () => ({page: targetPage, pageId: 'page-2', pageIdx: 1}),
      getNetworkRequestsForPage: page => {
        assert.equal(page, targetPage);
        reads += 1;
        pages = [targetPage, firstPage];
        return reads > 1 ? [matchingRequest] : [];
      },
      getNetworkRequestStableId: () => 700,
    });

    const result = await networkModule.listRequests(services, {
      targetPageId: 'page-2',
      waitForRequest: '/pinned',
      waitTimeoutMs: 150,
    });

    assert.equal(result.success, true);
    assert.equal(result.data.targetPageIdx, 1);
    assert.equal(result.data.targetPageId, 'page-2');
    assert.equal(result.data.requests[0]?.reqid, 700);
  });

  it('returns timeout failure immediately when waitTimeoutMs is 0', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const start = Date.now();

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      waitForRequest: '/never',
      waitTimeoutMs: 0,
    });

    const durationMs = Date.now() - start;
    assert.equal(result.success, false);
    assert.match(result.message || '', /等待请求超时/);
    assert.equal(result.data.timedOut, true);
    assert.ok(
      durationMs < 40,
      `expected immediate timeout, got ${durationMs}ms`,
    );
  });

  it('returns explicit timeout failure when no matching request arrives', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      waitForRequest: '/missing',
      waitTimeoutMs: 30,
    });

    assert.equal(result.success, false);
    assert.match(result.message || '', /等待请求超时/);
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

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      headerFilter: 'x-zse-96',
    });

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

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      headerFilter: 'sign',
      includeSignatureEvidence: true,
    });

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
          '调用 break_on_xhr 在请求发送前暂停',
          '暂停后调用 get_paused_info 和 evaluate_on_callframe 查看局部变量',
        ],
      },
    ]);
  });

  it('filters requests by URL keyword', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const zhihuRequest = createRequest('https://www.zhihu.com/api/v4/feed');
    const otherRequest = createRequest('https://example.test/api/order');

    const services = createMockServices({
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
    });

    const result = await networkModule.listRequests(services, {
      urlFilter: 'zhihu.com',
    });

    assert.equal(result.success, true);
    assert.equal(result.data.requests.length, 1);
    assert.equal(
      result.data.requests[0]?.url,
      'https://www.zhihu.com/api/v4/feed',
    );
  });

  it('hides browser extension requests by default', async () => {
    const page = {id: 0};
    const siteRequest = createRequest('https://example.test/a/guide1');
    const extensionRequest = createRequest(
      'chrome-extension://abcdef/background.json',
    );
    const services = createMockServices({
      getPages: () => [page],
      getSelectedPage: () => page,
      getSelectedPageIndex: () => 0,
      getNetworkRequests: () => [extensionRequest, siteRequest] as never[],
      getNetworkRequestStableId: request =>
        request === (siteRequest as never) ? 401 : 402,
    });

    const result = await networkModule.listRequests(services, {});

    assert.deepEqual(
      result.data.requests.map(request => request.url),
      ['https://example.test/a/guide1'],
    );
  });

  it('can include browser extension requests explicitly', async () => {
    const page = {id: 0};
    const extensionRequest = createRequest(
      'chrome-extension://abcdef/background.json',
    );
    const services = createMockServices({
      getPages: () => [page],
      getSelectedPage: () => page,
      getSelectedPageIndex: () => 0,
      getNetworkRequests: () => [extensionRequest] as never[],
      getNetworkRequestStableId: () => 402,
    });

    const result = await networkModule.listRequests(services, {
      includeExtensionRequests: true,
    });

    assert.equal(
      result.data.requests[0]?.url,
      'chrome-extension://abcdef/background.json',
    );
  });
});
