/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {setRuntime} from '../../../src/runtime.js';
import {collectCode} from '../../../src/tools/collector/collectCode.js';
import {searchInScripts} from '../../../src/tools/collector/searchInScripts.js';

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
  it('returns suggestion when collect() returns NO_PAGE_CONTEXT', async () => {
    const stubRuntime = {
      collector: {
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
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await collectCode.handler(
        {params: {url: 'https://example.com'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, false);
      assert.ok(result.suggestion);
      assert.match(result.suggestion, /select_page|new_page/);
    } finally {
      setRuntime(undefined);
    }
  });

  it('returns suggestion on thrown browser init failure', async () => {
    const stubRuntime = {
      collector: {
        getCollectedFilesSummary: () => [],
        collect: async () => {
          throw new Error('Browser not initialized');
        },
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await collectCode.handler(
        {params: {url: 'https://example.com'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, false);
      assert.ok(result.suggestion);
    } finally {
      setRuntime(undefined);
    }
  });
});

describe('search_in_scripts tool-layer error handling', () => {
  it('returns error with suggestion for INVALID_PATTERN', async () => {
    const stubRuntime = {
      collector: {
        getFilesByPattern: () => ({
          files: [],
          totalSize: 0,
          matched: 0,
          returned: 0,
          truncated: false,
          error: 'INVALID_PATTERN',
          message: '无效的正则表达式: [invalid',
        }),
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await searchInScripts.handler(
        {params: {pattern: '[invalid'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, false);
      assert.ok(result.suggestion);
      assert.match(result.suggestion, /正则/);
    } finally {
      setRuntime(undefined);
    }
  });

  it('returns warning when cache is empty', async () => {
    const stubRuntime = {
      collector: {
        getFilesByPattern: () => ({
          files: [],
          totalSize: 0,
          matched: 0,
          returned: 0,
          truncated: false,
          warning: '脚本缓存为空。请先调用 collect_code 收集脚本后再搜索。',
        }),
      },
    } as any;
    setRuntime(stubRuntime);

    const {response, getContent} = buildMockResponse();
    try {
      await searchInScripts.handler(
        {params: {pattern: 'sign'}} as any,
        response as any,
        {} as any,
      );
      const result = getContent();
      assert.equal(result.success, true);
      assert.ok(result.message.includes('缓存为空'));
    } finally {
      setRuntime(undefined);
    }
  });
});
