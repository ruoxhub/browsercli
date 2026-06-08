/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {getRuntime} from '../../../../src/runtime.js';
import {clearNetworkRequests} from '../../../../src/tools/network/clearNetworkRequests.js';
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

function createMockResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (value: string) => lines.push(value),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (content: unknown) => {
      lines.push(JSON.stringify(content));
    },
  };
}

function parseResult(
  response: ReturnType<typeof createMockResponse>,
): Record<string, unknown> {
  const jsonLine = response.lines.find(line => line.trim().startsWith('{'));
  if (!jsonLine) {
    throw new Error(
      'No JSON line found in response: ' + response.lines.join('\n'),
    );
  }
  return JSON.parse(jsonLine);
}

function setupContextProvider(services: {
  getPages?: () => unknown[];
  getSelectedPage?: () => unknown | null;
  getSelectedPageIndex?: () => number | null;
  getNetworkRequests?: (
    includePreserved?: boolean,
    pageIdx?: number,
  ) => unknown[];
  clearNetworkRequests?: (pageIdx?: number) => void;
}) {
  const runtime = getRuntime();
  runtime.contextProvider = services as never;
}

describe('clearNetworkRequests', () => {
  it('clears requests for the active page and reports the count', async () => {
    const pages = [{id: 0}, {id: 1}];
    const selectedPage = pages[1];
    const clearedPageIndexes: Array<number | undefined> = [];
    const requests = [
      createRequest('https://example.test/a'),
      createRequest('https://example.test/b'),
    ];

    const response = createMockResponse();
    setupContextProvider({
      getPages: () => pages as never[],
      getSelectedPage: () => selectedPage as never,
      getSelectedPageIndex: () => 1,
      getNetworkRequests: () => requests as never[],
      clearNetworkRequests: pageIdx => {
        clearedPageIndexes.push(pageIdx);
      },
    });

    await clearNetworkRequests.handler(
      {params: {}} as never,
      response as never,
      undefined,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.deepStrictEqual(clearedPageIndexes, [1]);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.clearedCount, 2);
    assert.equal(data.targetPageIdx, 1);
    assert.match(result.message as string, /页面 1/);
    assert.match(result.message as string, /2 个/);
  });

  it('uses explicit targetPageIdx when provided', async () => {
    const clearedPageIndexes: Array<number | undefined> = [];

    const response = createMockResponse();
    setupContextProvider({
      getNetworkRequests: () => [createRequest('https://example.test/x')] as never[],
      clearNetworkRequests: pageIdx => {
        clearedPageIndexes.push(pageIdx);
      },
    });

    await clearNetworkRequests.handler(
      {params: {targetPageIdx: 3}} as never,
      response as never,
      undefined,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.deepStrictEqual(clearedPageIndexes, [3]);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.targetPageIdx, 3);
    assert.equal(data.clearedCount, 1);
  });

  it('reports zero cleared count and a friendly message when buffer is empty', async () => {
    const pages = [{id: 0}];
    const selectedPage = pages[0];
    const clearedCalls: Array<number | undefined> = [];

    const response = createMockResponse();
    setupContextProvider({
      getPages: () => pages as never[],
      getSelectedPage: () => selectedPage as never,
      getSelectedPageIndex: () => 0,
      getNetworkRequests: () => [] as never[],
      clearNetworkRequests: pageIdx => {
        clearedCalls.push(pageIdx);
      },
    });

    await clearNetworkRequests.handler(
      {params: {}} as never,
      response as never,
      undefined,
    );

    const result = parseResult(response);
    assert.equal(result.success, true);
    assert.deepStrictEqual(clearedCalls, [0]);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.clearedCount, 0);
    assert.equal(data.targetPageIdx, 0);
    assert.match(result.message as string, /没有可清空/);
  });

  it('returns failure when there is no active page', async () => {
    const clearedCalls: Array<number | undefined> = [];

    const response = createMockResponse();
    setupContextProvider({
      getPages: () => [],
      getSelectedPage: () => null,
      getSelectedPageIndex: () => null,
      getNetworkRequests: () => [] as never[],
      clearNetworkRequests: pageIdx => {
        clearedCalls.push(pageIdx);
      },
    });

    await clearNetworkRequests.handler(
      {params: {}} as never,
      response as never,
      undefined,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.equal(result.message, NO_ACTIVE_PAGE_MESSAGE);
    assert.equal(clearedCalls.length, 0, '未选中页面时不应触发清空');
    const data = result.data as Record<string, unknown>;
    assert.equal(data.clearedCount, 0);
    assert.equal(data.targetPageIdx, 0);
  });

  it('catches and reports errors from the underlying collector', async () => {
    const response = createMockResponse();
    setupContextProvider({
      getPages: () => [{id: 0}],
      getSelectedPage: () => ({id: 0}) as never,
      getSelectedPageIndex: () => 0,
      getNetworkRequests: () => [createRequest('https://example.test/y')] as never[],
      clearNetworkRequests: () => {
        throw new Error('boom from collector');
      },
    });

    await clearNetworkRequests.handler(
      {params: {}} as never,
      response as never,
      undefined,
    );

    const result = parseResult(response);
    assert.equal(result.success, false);
    assert.match(result.message as string, /boom from collector/);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.clearedCount, 0);
  });
});
