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

function createRequest(url: string): TestRequest {
  return {
    url: () => url,
    method: () => 'GET',
    postData: () => null,
    resourceType: () => 'xhr',
    headers: () => ({}),
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
  clearNetworkRequests?: (pageIdx?: number) => void;
  clearNetworkRequestsForPage?: (page: unknown) => void;
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
        if (!page && selector.pageIdx !== undefined)
          return {page: {id: pageIdx}, pageId: `page-${pageIdx + 1}`, pageIdx};
        if (!page) throw new Error(NO_ACTIVE_PAGE_MESSAGE);
        return {page, pageId: `page-${pageIdx + 1}`, pageIdx};
      }),
    getPages: services.getPages ?? (() => []),
    getSelectedPage: services.getSelectedPage ?? (() => null),
    getSelectedPageIndex: services.getSelectedPageIndex,
    getNetworkRequests: services.getNetworkRequests ?? (() => []),
    getNetworkRequestsForPage: (page, includePreserved) => {
      const pages = services.getPages?.() ?? [];
      const pageIdx = pages.indexOf(page);
      return (
        services.getNetworkRequests?.(
          includePreserved,
          pageIdx >= 0 ? pageIdx : (page as any).id,
        ) ?? []
      );
    },
    getNetworkRequestById: () => ({}) as any,
    getNetworkRequestStableId: () => 1,
    getRequestInitiator: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    clearNetworkRequests: services.clearNetworkRequests ?? (() => {}),
    clearNetworkRequestsForPage:
      services.clearNetworkRequestsForPage ??
      (page => {
        const pages = services.getPages?.() ?? [];
        const pageIdx = pages.indexOf(page);
        services.clearNetworkRequests?.(
          pageIdx >= 0 ? pageIdx : (page as any).id,
        );
      }),
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

describe('clearNetworkRequests', () => {
  const networkModule = new NetworkModule();

  it('clears requests for the active page and reports the count', () => {
    const pages = [{id: 0}, {id: 1}];
    const selectedPage = pages[1];
    const clearedPageIndexes: Array<number | undefined> = [];
    const requests = [
      createRequest('https://example.test/a'),
      createRequest('https://example.test/b'),
    ];

    const services = createMockServices({
      getPages: () => pages as never[],
      getSelectedPage: () => selectedPage as never,
      getSelectedPageIndex: () => 1,
      getNetworkRequests: () => requests as never[],
      clearNetworkRequests: pageIdx => {
        clearedPageIndexes.push(pageIdx);
      },
    });

    const result = networkModule.clearRequests(services, {});

    assert.equal(result.success, true);
    assert.deepStrictEqual(clearedPageIndexes, [1]);
    assert.equal(result.data.clearedCount, 2);
    assert.equal(result.data.targetPageIdx, 1);
    assert.match(result.message, /页面 1/);
    assert.match(result.message, /2 个/);
  });

  it('uses explicit targetPageIdx when provided', () => {
    const clearedPageIndexes: Array<number | undefined> = [];

    const services = createMockServices({
      getNetworkRequests: () =>
        [createRequest('https://example.test/x')] as never[],
      clearNetworkRequests: pageIdx => {
        clearedPageIndexes.push(pageIdx);
      },
    });

    const result = networkModule.clearRequests(services, {targetPageIdx: 3});

    assert.equal(result.success, true);
    assert.deepStrictEqual(clearedPageIndexes, [3]);
    assert.equal(result.data.targetPageIdx, 3);
    assert.equal(result.data.clearedCount, 1);
  });

  it('reports zero cleared count and a friendly message when buffer is empty', () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const clearedCalls: Array<number | undefined> = [];

    const services = createMockServices({
      getPages: () => pages as never[],
      getSelectedPage: () => selectedPage as never,
      getSelectedPageIndex: () => 0,
      getNetworkRequests: () => [] as never[],
      clearNetworkRequests: pageIdx => {
        clearedCalls.push(pageIdx);
      },
    });

    const result = networkModule.clearRequests(services, {});

    assert.equal(result.success, true);
    assert.deepStrictEqual(clearedCalls, [0]);
    assert.equal(result.data.clearedCount, 0);
    assert.equal(result.data.targetPageIdx, 0);
    assert.match(result.message, /没有可清空/);
  });

  it('returns failure when there is no active page', () => {
    const clearedCalls: Array<number | undefined> = [];

    const services = createMockServices({
      getPages: () => [],
      getSelectedPage: () => null,
      getSelectedPageIndex: () => null,
      getNetworkRequests: () => [] as never[],
      clearNetworkRequests: pageIdx => {
        clearedCalls.push(pageIdx);
      },
    });

    const result = networkModule.clearRequests(services, {});

    assert.equal(result.success, false);
    assert.equal(result.message, NO_ACTIVE_PAGE_MESSAGE);
    assert.equal(clearedCalls.length, 0, '未选中页面时不应触发清空');
    assert.equal(result.data.clearedCount, 0);
    assert.equal(result.data.targetPageIdx, 0);
  });

  it('catches and reports errors from the underlying collector', () => {
    const services = createMockServices({
      getPages: () => [{id: 0}],
      getSelectedPage: () => ({id: 0}) as never,
      getSelectedPageIndex: () => 0,
      getNetworkRequests: () =>
        [createRequest('https://example.test/y')] as never[],
      clearNetworkRequests: () => {
        throw new Error('boom from collector');
      },
    });

    const result = networkModule.clearRequests(services, {});

    assert.equal(result.success, false);
    assert.match(result.message, /boom from collector/);
    assert.equal(result.data.clearedCount, 0);
  });
});
