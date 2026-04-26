/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {getToolMeta} from '../../../src/cli/tools-meta.js';
import {siteExperienceService} from '../../../src/services/SiteExperienceService.js';
import {ToolAdapter} from '../../../src/worker/ToolAdapter.js';
import {ToolContextProvider} from '../../../src/worker/ToolContextProvider.js';

interface ResolvePayload {
  structuredContent?: {
    success: boolean;
    tooltype: string;
    hookId?: string;
    syncedHookIds?: string[];
    data?: unknown;
  };
}

describe('ToolAdapter', () => {
  it('passes params objects through params-only site experience tools', async () => {
    const runtime = new ToolContextProvider();
    const adapter = new ToolAdapter(runtime);
    const meta = getToolMeta('search_site_experience');
    assert.ok(meta, 'missing meta for search_site_experience');

    const originalSearch = siteExperienceService.search;
    let capturedParams: {url?: string; name?: string} | undefined;

    siteExperienceService.search = async params => {
      capturedParams = params;
      return [];
    };

    try {
      const result = await new Promise<ResolvePayload>((resolve, reject) => {
        void adapter.wrapTool(meta!)(
          {params: {url: 'https://www.douyin.com'}},
          value => resolve(value as ResolvePayload),
          reject,
        );
      });

      assert.deepStrictEqual(capturedParams, {
        url: 'https://www.douyin.com',
      });
      assert.deepStrictEqual(result.structuredContent, {
        success: true,
        message: '找到 0 条站点经验',
        tooltype: 'search_site_experience',
        results: [],
      });
    } finally {
      siteExperienceService.search = originalSearch;
    }
  });

  it('passes params objects through frame callMode hook management tools', async () => {
    const runtime = new ToolContextProvider();
    const evaluateCalls: Array<{
      kind: 'reader' | 'cleanup';
      hookId?: string;
      script?: string;
    }> = [];
    const frame = {
      evaluate: async (arg: unknown, hookId?: string) => {
        if (typeof arg === 'function') {
          evaluateCalls.push({kind: 'reader', hookId});
          return {
            [hookId || 'all']: [{event: 'call', target: 'window.fetch'}],
          };
        }

        evaluateCalls.push({kind: 'cleanup', script: String(arg)});
        return undefined;
      },
    };
    const page = {
      mainFrame: () => frame,
    };

    runtime.setSelectedPage(page as never);

    const adapter = new ToolAdapter(runtime);
    const runTool = async (
      toolName: 'get_hook_data' | 'list_created_hooks' | 'remove_hook',
    ): Promise<ResolvePayload> => {
      const meta = getToolMeta(toolName);
      assert.ok(meta, `missing meta for ${toolName}`);

      return await new Promise<ResolvePayload>((resolve, reject) => {
        void adapter.wrapTool(meta!)(
          {params: {hookId: 'hook_from_params'}},
          value => resolve(value as ResolvePayload),
          reject,
        );
      });
    };

    const getResult = await runTool('get_hook_data');
    const listResult = await runTool('list_created_hooks');
    const removeResult = await runTool('remove_hook');

    assert.deepStrictEqual(getResult.structuredContent, {
      success: true,
      message: '已获取 Hook hook_from_params 的数据',
      tooltype: 'get_hook_data',
      data: {
        hook_from_params: [{event: 'call', target: 'window.fetch'}],
      },
    });

    assert.deepStrictEqual(listResult.structuredContent, {
      success: true,
      message: '同步完成，1 个 Hook，共 1 条记录',
      tooltype: 'list_created_hooks',
      syncedHookIds: ['hook_from_params'],
      totalRecords: 1,
      hooks: [{hookId: 'hook_from_params', total: 1, type: 'fetch'}],
    });

    assert.deepStrictEqual(removeResult.structuredContent, {
      success: true,
      message: '浏览器端 Hook 数据已清理：hook_from_params',
      tooltype: 'remove_hook',
      hookId: 'hook_from_params',
    });

    const readerHookIds = evaluateCalls
      .filter(call => call.kind === 'reader')
      .map(call => call.hookId);
    assert.deepStrictEqual(readerHookIds, [
      'hook_from_params',
      'hook_from_params',
    ]);

    const cleanupCall = evaluateCalls.find(call => call.kind === 'cleanup');
    assert.ok(cleanupCall?.script?.includes('window.__hookStore'));
    assert.ok(cleanupCall?.script?.includes('"hook_from_params"'));
  });
});
