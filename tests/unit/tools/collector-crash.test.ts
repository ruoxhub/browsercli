/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {collectCode} from '../../../src/tools/collector.js';

function buildMockResponse() {
  let content: any = null;
  return {
    response: {
      setStructuredContent(c: any) {
        content = c;
      },
    },
    getContent: () => content,
  };
}

describe('collect_code tool-layer error handling', () => {
  it('throws ToolError with recovery suggestion when collect() returns NO_PAGE_CONTEXT', async () => {
    const fakeCollector = {
      getCollectedFilesSummary: () => [],
      collect: async () => ({
        files: [],
        dependencies: {nodes: [], edges: []},
        totalSize: 0,
        collectTime: 0,
        error: 'NO_PAGE_CONTEXT',
        message:
          '页面上下文未就绪。请先调用 select_page 或 new_page 选择一个页面。',
      }),
    };
    const {response} = buildMockResponse();
    await assert.rejects(
      collectCode.handler(
        {params: {url: 'https://example.com'}} as any,
        response as any,
        {getCodeCollector: () => fakeCollector} as any,
      ),
      (error: any) =>
        error?.code === 'PAGE_REQUIRED' &&
        /select_page|new_page/.test(error?.recovery?.command ?? error?.message),
    );
  });

  it('throws ToolError on thrown browser init failure', async () => {
    const fakeCollector = {
      getCollectedFilesSummary: () => [],
      collect: async () => {
        throw new Error('Browser not initialized');
      },
    };
    const {response} = buildMockResponse();
    await assert.rejects(
      collectCode.handler(
        {params: {url: 'https://example.com'}} as any,
        response as any,
        {getCodeCollector: () => fakeCollector} as any,
      ),
      (error: any) =>
        error instanceof Error && /Browser not initialized/.test(error.message),
    );
  });
});
