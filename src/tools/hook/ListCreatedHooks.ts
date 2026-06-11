/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

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
    hookId: zod
      .string()
      .optional()
      .describe('Specific hook ID to inspect, omit for all'),
    verbose: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Include detailed records per hook'),
    syncFromBrowser: zod
      .boolean()
      .optional()
      .default(false)
      .describe('Sync data from browser before listing'),
  },
  handler: async (request, response, context) => {
    const {hookId, verbose = false} = request.params;
    const syncFromBrowser = request.params.syncFromBrowser ?? Boolean(hookId);
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

      // 3. 如果有浏览器同步数据，合并记录数并构建摘要
      const hasBrowserData =
        browserData !== null && typeof browserData === 'object';
      const legacySummary = hasBrowserData
        ? summarizeHookStore(browserData!, {preserveEmpty: true})
        : null;

      if (legacySummary) {
        for (const hook of hooks) {
          const browserHook = legacySummary.hooks.find(
            h => h.hookId === (hook as {hookId: string}).hookId,
          );
          if (browserHook) {
            (hook as Record<string, unknown>).browserRecordCount =
              browserHook.total;
          }
        }
      }

      if (legacySummary) {
        response.setStructuredContent({
          success: true,
          message: `同步完成，${legacySummary.totalHooks} 个 Hook，共 ${legacySummary.totalRecords} 条记录`,
          tooltype: 'list_created_hooks',
          syncedHookIds: legacySummary.hooks.map(h => h.hookId),
          totalRecords: legacySummary.totalRecords,
          hooks: legacySummary.hooks.map(h => ({
            hookId: h.hookId,
            total: h.total,
            type: h.type,
          })),
        });
      } else {
        response.setStructuredContent({
          success: true,
          message: `共 ${hooks.length} 个 Hook`,
          tooltype: 'list_created_hooks',
          data: {
            totalHooks: hooks.length,
            totalEnabled: allHooks.filter(h => h.enabled).length,
            totalDisabled: allHooks.filter(h => !h.enabled).length,
            hooks,
          },
        });
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `列出 Hook 失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_created_hooks',
        data: {
          hooks: [] as unknown[],
        },
      });
    }
  },
});
