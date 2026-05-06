/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {readHookStore, summarizeHookStore} from './store-utils.js';

/**
 * 列出已创建的 Hook：从进程内 HookManager 获取元数据，
 * 并可选地从浏览器同步采集数据。
 *
 * 参考 old-source/src/tools/hook.ts 的 getHookData（list 部分）。
 */
export const listCreatedHooks = defineTool({
  name: 'list_created_hooks',
  description:
    'List all created hooks from HookManager. Optionally syncs browser-side data for record counts.',
  annotations: {
    title: 'List Created Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod.string().optional().describe('Specific hook ID to inspect, omit for all'),
    verbose: zod.boolean().optional().default(false).describe('Include detailed records per hook'),
    syncFromBrowser: zod.boolean().optional().default(false).describe('Sync data from browser before listing'),
  },
  handler: async (request, response, context) => {
    const {hookId, verbose = false, syncFromBrowser = false} = request.params;
    const runtime = getRuntime();

    try {
      // 1. 可选：从浏览器同步数据到 HookStore
      let browserData: Record<string, unknown[]> | null = null;
      if (syncFromBrowser) {
        try {
          const frame = (context as Context).getSelectedFrame();
          browserData = await readHookStore(frame, hookId);
        } catch {
          // 浏览器不可用，跳过同步
        }
      }

      // 2. 从进程内 HookManager 获取 hook 元数据（核心操作，不需要浏览器）
      const allHooks = runtime.hookManager.getAllHooks();
      const allKnownIds = runtime.hookManager.getAllKnownHookIds();

      const targetIds = hookId ? [hookId] : allKnownIds;

      const hooks = targetIds.map(id => {
        const meta = runtime.hookManager.getHook(id);
        const records = runtime.hookManager.getRecords(id);

        const entry: Record<string, unknown> = {
          hookId: id,
          type: meta?.type ?? 'unknown',
          description: meta?.description ?? '',
          enabled: meta?.enabled ?? true,
          callCount: meta?.callCount ?? records.length,
          recordCount: records.length,
        };

        if (verbose && records.length > 0) {
          entry.recentRecords = records.slice(-10);
        }

        if (meta?.script) {
          entry.scriptLength = meta.script.length;
        }

        return entry;
      });

      // 3. 如果有浏览器同步数据，合并记录数
      if (browserData && typeof browserData === 'object') {
        const summary = summarizeHookStore(browserData, {
          preserveEmpty: true,
        });
        for (const hook of hooks) {
          const browserHook = summary.hooks.find(h => h.hookId === (hook as {hookId: string}).hookId);
          if (browserHook) {
            (hook as Record<string, unknown>).browserRecordCount = browserHook.total;
          }
        }
      }

      const result = {
        success: true,
        message: `共 ${hooks.length} 个 Hook`,
        tooltype: 'list_created_hooks',
        totalHooks: hooks.length,
        totalEnabled: allHooks.filter(h => h.enabled).length,
        totalDisabled: allHooks.filter(h => !h.enabled).length,
        hooks,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `列出 Hook 失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_created_hooks',
        hooks: [],
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
