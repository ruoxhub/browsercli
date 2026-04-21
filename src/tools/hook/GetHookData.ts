/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {GetHookDataResult} from './types.js';

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
  hookId?: string,
): Promise<GetHookDataResult> {
  try {
    const data = await frame.evaluate((id?: string) => {
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

    return {
      success: true,
      message: hookId
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
