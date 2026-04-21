/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {SyncHookRecordsResult} from './types.js';

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
  hookId?: string,
): Promise<SyncHookRecordsResult> {
  try {
    const storeSnapshot = await frame.evaluate((id?: string) => {
      const rawStore = (window as typeof window & {__hookStore?: unknown})
        .__hookStore;
      const store =
        rawStore && typeof rawStore === 'object'
          ? (rawStore as Record<string, unknown>)
          : {};

      const normalize = (value: unknown) => (Array.isArray(value) ? value : []);

      if (typeof id === 'string' && id.length > 0) {
        return {[id]: normalize(store[id])};
      }

      const all: Record<string, unknown[]> = {};
      for (const [key, value] of Object.entries(store)) {
        if (Array.isArray(value)) {
          all[key] = value;
        }
      }
      return all;
    }, hookId);

    if (!storeSnapshot || typeof storeSnapshot !== 'object') {
      return {
        success: true,
        message: '浏览器端无 Hook 数据',
        tooltype: 'sync_hook_records',
        syncedHookIds: [],
        totalRecords: 0,
      };
    }

    const syncedHookIds: string[] = [];
    let totalRecords = 0;

    for (const [id, records] of Object.entries(
      storeSnapshot as Record<string, unknown>,
    )) {
      if (Array.isArray(records)) {
        syncedHookIds.push(id);
        totalRecords += records.length;
      }
    }

    return {
      success: true,
      message: `同步完成，${syncedHookIds.length} 个 Hook，共 ${totalRecords} 条记录`,
      tooltype: 'sync_hook_records',
      syncedHookIds,
      totalRecords,
    };
  } catch (error) {
    return {
      success: false,
      message: `同步失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'sync_hook_records',
      syncedHookIds: [],
      totalRecords: 0,
    };
  }
}
