/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {summarizeHookStore, readHookStore} from './store-utils.js';
import type {SyncHookRecordsResult} from './types.js';

interface SyncHookRecordsParams {
  hookId?: string;
  verbose?: boolean;
  type?: string;
  event?: string;
  phase?: string;
}

function normalizeParams(
  params?: string | SyncHookRecordsParams,
): Pick<
  SyncHookRecordsParams,
  'hookId' | 'verbose' | 'type' | 'event' | 'phase'
> {
  if (typeof params === 'string') {
    return {hookId: params};
  }

  if (params && typeof params === 'object') {
    return {
      hookId: typeof params.hookId === 'string' ? params.hookId : undefined,
      verbose: params.verbose === true,
      type: typeof params.type === 'string' ? params.type : undefined,
      event: typeof params.event === 'string' ? params.event : undefined,
      phase: typeof params.phase === 'string' ? params.phase : undefined,
    };
  }

  return {};
}

/**
 * 将 Hook 记录从浏览器端同步到 Node.js 端。
 *
 * 从页面的 window.__hookStore 中提取 Hook 采集的数据，
 * 返回原始数据供调用方进一步处理（归一化、汇总等）。
 *
 * @param frame - Puppeteer Frame 对象
 * @param hookId - 可选，指定同步某个 Hook 的数据；省略则同步全部
 * @returns 结构化结果对象，data 字段包含从浏览器同步的原始记录
 */
export async function syncHookRecords(
  frame: Frame,
  params?: string | SyncHookRecordsParams,
): Promise<SyncHookRecordsResult> {
  const {hookId, verbose, type, event, phase} = normalizeParams(params);

  try {
    const storeSnapshot = await readHookStore(frame, hookId);

    if (!storeSnapshot || typeof storeSnapshot !== 'object') {
      return {
        success: true,
        message: '浏览器端无 Hook 数据',
        tooltype: 'list_created_hooks',
        syncedHookIds: [],
        totalRecords: 0,
        hooks: [],
      };
    }

    const summary = summarizeHookStore(storeSnapshot, {
      type,
      event,
      phase,
      preserveEmpty: Boolean(hookId) || (!type && !event && !phase),
    });
    const hooks = verbose
      ? summary.hooks
      : summary.hooks.map(({hookId: id, total, type}) => ({
          hookId: id,
          total,
          type,
        }));

    return {
      success: true,
      message: `同步完成，${summary.totalHooks} 个 Hook，共 ${summary.totalRecords} 条记录`,
      tooltype: 'list_created_hooks',
      syncedHookIds: summary.hooks.map(item => item.hookId),
      totalRecords: summary.totalRecords,
      hooks,
    };
  } catch (error) {
    return {
      success: false,
      message: `同步失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'list_created_hooks',
      syncedHookIds: [],
      totalRecords: 0,
      hooks: [],
    };
  }
}
