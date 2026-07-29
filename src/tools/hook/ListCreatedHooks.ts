/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {errorMessage} from '../shared/pageResponse.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {
  readHookStore,
  readMcpHookRegistry,
  summarizeHookStore,
} from './store-utils.js';

/**
 * 列出已创建的 Hook：从进程内 HookManager 获取元数据，
 * 并可选地从浏览器同步采集数据。
 *
 * 参考 old-source/src/tools/hook.ts 的 getHookData（list 部分）。
 */
export const listCreatedHooks = defineTool({
  name: 'list_created_hooks',
  description:
    '列出 HookManager 中所有已创建的 hook。可选地同步浏览器端数据以统计记录数。',
  annotations: {
    title: 'List Created Hooks',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('指定要查看的 Hook ID，省略则返回全部'),
    verbose: zod
      .boolean()
      .optional()
      .default(false)
      .describe('包含每个 Hook 的详细记录'),
    syncFromBrowser: zod
      .boolean()
      .optional()
      .default(false)
      .describe('列出前先从浏览器同步数据'),
  },
  handler: async (request, response, context) => {
    const {hookId, verbose = false} = request.params;
    // 默认从浏览器同步，确保 hook_function / inject_hook / auto_hook 等
    // 仅存在于页面侧（window.__mcp_hooks__ / window.__hookStore）的 Hook
    // 也能被完整列出（修复：此前浏览器与进程内 Hook 未合并展示）。
    const syncFromBrowser = request.params.syncFromBrowser ?? true;
    const runtime = getRuntime();

    try {
      let browserStore: Record<string, unknown[]> | null = null;
      let browserRegistry: Array<{id: string; target: string}> = [];
      if (syncFromBrowser) {
        try {
          const frame = (context as Context).getSelectedFrame();
          browserStore = await readHookStore(frame, hookId);
          browserRegistry = await readMcpHookRegistry(frame);
        } catch {
          // 浏览器不可用，跳过同步，仅返回进程内 HookManager 数据
        }
      }

      // 统一合并三个来源，按 hookId 去重：
      //   1) 进程内 HookManager（create_hook / inject_hook / auto_hook 等注册）
      //   2) 浏览器 window.__mcp_hooks__（hook_function 的活跃注册表，含 0 记录 Hook）
      //   3) 浏览器 window.__hookStore（各类 Hook 的调用记录）
      const merged = new Map<string, Record<string, unknown>>();

      // 1) HookManager
      const managerIds = hookId
        ? [hookId]
        : runtime.hookManager.getAllKnownHookIds();
      for (const id of managerIds) {
        const meta = runtime.hookManager.getHook(id);
        const records = runtime.hookManager.getRecords(id);
        if (!meta && records.length === 0 && !hookId) {
          continue;
        }
        const entry: Record<string, unknown> = {
          hookId: id,
          source: 'manager',
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
        merged.set(id, entry);
      }

      // 2) window.__mcp_hooks__（活跃注册表）
      for (const reg of browserRegistry) {
        if (hookId && reg.id !== hookId) {
          continue;
        }
        const existing = merged.get(reg.id);
        if (existing) {
          existing.browserActive = true;
          if (!existing.target) {
            existing.target = reg.target;
          }
        } else {
          merged.set(reg.id, {
            hookId: reg.id,
            source: 'browser',
            type: 'function',
            target: reg.target,
            enabled: true,
            browserActive: true,
            recordCount: 0,
          });
        }
      }

      // 3) window.__hookStore（调用记录）
      if (browserStore && typeof browserStore === 'object') {
        const summary = summarizeHookStore(browserStore, {preserveEmpty: true});
        for (const h of summary.hooks) {
          if (hookId && h.hookId !== hookId) {
            continue;
          }
          const existing = merged.get(h.hookId);
          if (existing) {
            existing.browserRecordCount = h.total;
            if (!existing.type || existing.type === 'unknown') {
              existing.type = h.type;
            }
            if (verbose && h.recentRecords.length > 0) {
              existing.browserRecentRecords = h.recentRecords.slice(-10);
            }
          } else {
            const entry: Record<string, unknown> = {
              hookId: h.hookId,
              source: 'browser',
              type: h.type,
              enabled: true,
              recordCount: h.total,
              browserRecordCount: h.total,
            };
            if (verbose && h.recentRecords.length > 0) {
              entry.browserRecentRecords = h.recentRecords.slice(-10);
            }
            merged.set(h.hookId, entry);
          }
        }
      }

      const hooks = Array.from(merged.values());
      const totalRecords = hooks.reduce(
        (sum, h) => sum + Number(h.browserRecordCount ?? h.recordCount ?? 0),
        0,
      );

      if (browserStore && typeof browserStore === 'object') {
        const summary = summarizeHookStore(browserStore, {
          preserveEmpty: true,
        });
        response.setStructuredContent({
          success: true,
          message: `同步完成，${summary.totalHooks} 个 Hook，共 ${summary.totalRecords} 条记录`,
          tooltype: 'list_created_hooks',
          syncedHookIds: summary.hooks.map(h => h.hookId),
          totalRecords: summary.totalRecords,
          hooks: verbose
            ? summary.hooks
            : summary.hooks.map(h => ({
                hookId: h.hookId,
                total: h.total,
                type: h.type,
              })),
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: `共 ${hooks.length} 个 Hook`,
        tooltype: 'list_created_hooks',
        syncedHookIds: hooks.map(h => String(h.hookId)),
        totalRecords,
        hooks,
        data: {
          totalHooks: hooks.length,
          totalEnabled: hooks.filter(h => h.enabled !== false).length,
          totalDisabled: hooks.filter(h => h.enabled === false).length,
          totalRecords,
          hooks,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `列出 Hook 失败：${errorMessage(error)}`,
        tooltype: 'list_created_hooks',
        data: {
          hooks: [] as unknown[],
        },
      });
    }
  },
});
