/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

import {
  buildRequestBindings,
  inferCandidateEnvNeeds,
  normalizeHookRecord,
  summarizeHookRecords,
  toHookRecordArray,
} from './record-utils.js';
import {
  filterHookStore,
  readHookStore,
  summarizeHookStore,
} from './store-utils.js';

interface HookDiagnostic {
  hookId: string;
  type: string;
  issue: 'hook_installed_no_records';
  likelyCauses: string[];
  nextSteps: string[];
}

/**
 * 从浏览器端获取 Hook 采集的数据，先同步到 HookManager 再读取。
 *
 * 参考 old-source/src/tools/hook.ts 的 getHookData。
 */
export const getHookData = defineTool({
  name: 'get_hook_data',
  description:
    'Get captured hook data. Syncs from browser to HookManager first, then returns data. Supports raw, summary, and detail views with filtering.',
  annotations: {
    title: 'Get Hook Data',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('Specific hook ID, omit for all hooks'),
    view: zod
      .enum(['raw', 'summary', 'detail'])
      .optional()
      .describe(
        'View mode: raw (original), summary (deduplicated), detail (with diagnostics), default raw',
      ),
    maxRecords: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of records to return'),
    type: zod.string().optional().describe('Filter by hook type'),
    event: zod.string().optional().describe('Filter by event name'),
    phase: zod.string().optional().describe('Filter by phase'),
  },
  handler: async (request, response, context) => {
    const {hookId, view, maxRecords, type, event, phase} = request.params;
    const runtime = getRuntime();

    try {
      // 1. 先从浏览器同步数据到 HookManager（参考 old-source 的 syncHookRecordsFromPage）
      let storeSnapshot: Record<string, unknown[]> = {};
      try {
        const frame = (context as Context).getSelectedFrame();
        const browserData = await readHookStore(frame, hookId);

        // 同步到 HookManager
        for (const [id, records] of Object.entries(browserData)) {
          runtime.hookManager.clearRecords(id);
          for (const record of toHookRecordArray(records)) {
            runtime.hookManager.addRecord(id, {
              hookId: id,
              timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
              ...record,
            });
          }
        }
        storeSnapshot = browserData;
      } catch {
        // 浏览器不可用，从 HookManager 读取已有数据
        const allIds = hookId ? [hookId] : runtime.hookManager.getAllKnownHookIds();
        for (const id of allIds) {
          storeSnapshot[id] = runtime.hookManager.getRecords(id);
        }
      }

      const filters = {type, event, phase, preserveEmpty: Boolean(hookId)};
      const data =
        view === 'summary'
          ? {
              view: 'summary' as const,
              ...summarizeHookStore(storeSnapshot, filters, maxRecords),
            }
          : view === 'detail'
            ? buildDetailedView(
                filterHookStore(storeSnapshot, filters, maxRecords),
                maxRecords,
              )
            : filterHookStore(storeSnapshot, filters, maxRecords);

      const result = {
        success: true,
        message:
          view === 'summary'
            ? hookId
              ? `已获取 Hook ${hookId} 的摘要`
              : '已获取全部 Hook 摘要'
            : view === 'detail'
              ? hookId
                ? `已获取 Hook ${hookId} 的详情`
                : '已获取全部 Hook 详情'
              : hookId
                ? `已获取 Hook ${hookId} 的数据`
                : '已获取全部 Hook 数据',
        tooltype: 'get_hook_data',
        data,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `获取失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_hook_data',
        data: null,
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});

function buildDetailedView(
  storeSnapshot: Record<string, unknown[]>,
  maxRecords?: number,
) {
  const normalizedRecords = Object.entries(storeSnapshot).flatMap(
    ([currentHookId, records]) =>
      toHookRecordArray(records).map(record =>
        normalizeHookRecord({
          ...record,
          hookId: record.hookId ?? currentHookId,
        }),
      ),
  );

  const diagnostics = buildHookDiagnostics(storeSnapshot);

  return {
    view: 'detail' as const,
    totalHooks: Object.keys(storeSnapshot).length,
    totalRecords: normalizedRecords.length,
    normalizedRecords:
      typeof maxRecords === 'number' && maxRecords > 0
        ? normalizedRecords.slice(-Math.floor(maxRecords))
        : normalizedRecords,
    ...(diagnostics.length > 0 ? {diagnostics} : {}),
    summary: summarizeHookRecords(normalizedRecords, maxRecords ?? 20),
    candidateEnvNeeds: inferCandidateEnvNeeds(normalizedRecords),
    requestBindings: buildRequestBindings(normalizedRecords),
  };
}

function buildHookDiagnostics(
  storeSnapshot: Record<string, unknown[]>,
): HookDiagnostic[] {
  return Object.entries(storeSnapshot)
    .filter(([, records]) => records.length === 0)
    .map(([hookId]) => ({
      hookId,
      type: inferDiagnosticHookType(hookId),
      issue: 'hook_installed_no_records' as const,
      likelyCauses: [
        '目标业务动作尚未触发',
        'Hook 注入晚于页面签名逻辑初始化',
        '当前选中的 Frame 与请求所在 Frame 不一致',
        '目标请求未经过该 Hook 类型',
      ],
      nextSteps: [
        '触发登录、下单、分页等目标业务动作后重新读取 get_hook_data',
        '使用 inject_preload_script 或在页面加载前安装 Hook',
        '用 list_frames / select_frame 确认 Hook 注入到正确 Frame',
        '升级到 xhr_to_js_breakpoint、get_paused_info、evaluate_on_callframe 调试链路',
      ],
    }));
}

function inferDiagnosticHookType(hookId: string): string {
  if (hookId.includes('fetch')) return 'fetch';
  if (hookId.includes('xhr')) return 'xhr';
  if (hookId.includes('crypto')) return 'crypto';
  if (hookId.includes('storage')) return 'storage';
  if (hookId.includes('cookie')) return 'cookie';
  return 'unknown';
}
