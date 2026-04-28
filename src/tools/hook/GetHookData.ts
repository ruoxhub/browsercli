/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {GetHookDataResult} from './types.js';
import {
  filterHookStore,
  readHookStore,
  summarizeHookStore,
} from './store-utils.js';
import {
  buildRequestBindings,
  inferCandidateEnvNeeds,
  normalizeHookRecord,
  summarizeHookRecords,
  toHookRecordArray,
} from './record-utils.js';

interface HookDataParams {
  hookId?: string;
  view?: 'raw' | 'summary' | 'detail';
  maxRecords?: number;
  type?: string;
  event?: string;
  phase?: string;
}

interface HookDiagnostic {
  hookId: string;
  type: string;
  issue: 'hook_installed_no_records';
  likelyCauses: string[];
  nextSteps: string[];
}

function normalizeParams(params?: string | HookDataParams): (Required<
  Pick<HookDataParams, 'view'>
> &
  Pick<
    HookDataParams,
    'hookId' | 'maxRecords' | 'type' | 'event' | 'phase'
  >) & {
  invalidView?: string;
} {
  if (typeof params === 'string') {
    return {hookId: params, view: 'raw'};
  }

  if (params && typeof params === 'object') {
    const requestedView = params.view;
    return {
      hookId: typeof params.hookId === 'string' ? params.hookId : undefined,
      view:
        requestedView === undefined || requestedView === 'raw'
          ? 'raw'
          : requestedView === 'summary'
            ? 'summary'
            : requestedView === 'detail'
              ? 'detail'
              : 'raw',
      maxRecords:
        typeof params.maxRecords === 'number' ? params.maxRecords : undefined,
      type: typeof params.type === 'string' ? params.type : undefined,
      event: typeof params.event === 'string' ? params.event : undefined,
      phase: typeof params.phase === 'string' ? params.phase : undefined,
      invalidView:
        requestedView !== undefined &&
        requestedView !== 'raw' &&
        requestedView !== 'summary' &&
        requestedView !== 'detail'
          ? String(requestedView)
          : undefined,
    };
  }

  return {hookId: undefined, view: 'raw'};
}

/**
 * 从浏览器端获取 Hook 采集的数据。
 *
 * 读取页面 window.__hookStore 中指定或全部 Hook 的数据，
 * 返回原始记录数组供调用方分析。
 *
 * @param frame - Puppeteer Frame 对象
 * @param hookId - 可选，指定获取某个 Hook 的数据；省略则获取全部
 * @returns 结构化结果对象，data 字段包含采集的原始记录
 */
export async function getHookData(
  frame: Frame,
  params?: string | HookDataParams,
): Promise<GetHookDataResult> {
  const {hookId, view, maxRecords, type, event, phase, invalidView} =
    normalizeParams(params);

  if (invalidView) {
    return {
      success: false,
      message: `view 参数无效：${invalidView}，仅支持 raw | summary | detail`,
      tooltype: 'get_hook_data',
      data: null,
    };
  }

  try {
    const storeSnapshot = await readHookStore(frame, hookId);
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

    return {
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
  } catch (error) {
    return {
      success: false,
      message: `获取失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_hook_data',
      data: null,
    };
  }
}

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
