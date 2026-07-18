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
    '获取 Hook 采集到的数据。会先从浏览器同步到 HookManager，再返回数据。支持 raw、summary、detail 三种视图并支持过滤。',
  annotations: {
    title: 'Get Hook Data',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    hookId: zod
      .string()
      .optional()
      .describe('指定 Hook ID，省略则返回全部 Hook'),
    view: zod
      .enum(['raw', 'summary', 'detail'])
      .optional()
      .describe(
        '视图模式：raw（原始）、summary（去重摘要）、detail（含诊断信息），默认 raw',
      ),
    maxRecords: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的最大记录条数'),
    type: zod.string().optional().describe('按 Hook 类型过滤'),
    event: zod.string().optional().describe('按事件名过滤'),
    phase: zod.string().optional().describe('按阶段过滤'),
  },
  handler: async (request, response, context) => {
    const {hookId, view, maxRecords, type, event, phase} = request.params;
    const runtime = getRuntime();

    try {
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
              timestamp:
                typeof record.timestamp === 'number'
                  ? record.timestamp
                  : Date.now(),
              ...record,
            });
          }
        }
        storeSnapshot = browserData;
      } catch {
        // 浏览器不可用，从 HookManager 读取已有数据
        const allIds = hookId
          ? [hookId]
          : runtime.hookManager.getAllKnownHookIds();
        for (const id of allIds) {
          storeSnapshot[id] = runtime.hookManager.getRecords(id);
        }
      }

      const filters = {type, event, phase, preserveEmpty: Boolean(hookId)};
      let data: unknown;
      if (view === 'summary') {
        data = {
          view: 'summary' as const,
          ...summarizeHookStore(storeSnapshot, filters, maxRecords),
        };
      } else if (view === 'detail') {
        data = buildDetailedView(
          filterHookStore(storeSnapshot, filters, maxRecords),
          maxRecords,
        );
      } else {
        data = filterHookStore(storeSnapshot, filters, maxRecords);
      }

      const viewLabel = getViewLabel(view);
      const scopeLabel = hookId ? ` Hook ${hookId} 的` : '全部 Hook';
      const result = {
        success: true,
        message: `已获取${scopeLabel}${viewLabel}`,
        tooltype: 'get_hook_data',
        data,
      };
      response.setStructuredContent(result);
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取失败：${errorMessage(error)}`,
        tooltype: 'get_hook_data',
        data: null,
      });
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

function getViewLabel(view: string | undefined): string {
  if (view === 'summary') return '摘要';
  if (view === 'detail') return '详情';
  return '数据';
}
