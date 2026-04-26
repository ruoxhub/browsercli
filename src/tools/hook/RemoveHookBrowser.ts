/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {RemoveHookBrowserResult} from './types.js';

interface RemoveHookBrowserParams {
  hookId?: string;
}

function normalizeHookId(
  params?: string | RemoveHookBrowserParams,
): string | undefined {
  if (typeof params === 'string') {
    return params;
  }
  if (
    params &&
    typeof params === 'object' &&
    typeof params.hookId === 'string'
  ) {
    return params.hookId;
  }
  return undefined;
}

/**
 * 清理浏览器端的 Hook 数据。
 *
 * 删除页面 window.__hookStore 中指定 Hook 的采集数据。
 * 注意：此操作不恢复被 monkey-patch 的原生方法，
 * 因为恢复可能导致页面状态不一致。
 *
 * @param frame - Puppeteer Frame 对象
 * @param hookId - 要清理的 Hook ID
 * @returns 结构化结果对象
 */
export async function removeHookBrowser(
  frame: Frame,
  params?: string | RemoveHookBrowserParams,
): Promise<RemoveHookBrowserResult> {
  const hookId = normalizeHookId(params);

  if (!hookId) {
    return {
      success: false,
      message: 'hookId 参数不能为空',
      tooltype: 'remove_hook',
      hookId: '',
    };
  }

  const serializedHookId = JSON.stringify(hookId);
  const cleanupScript = `(function(){
  var s = window.__hookStore;
  var hookId = ${serializedHookId};
  if (s && s[hookId]) {
    delete s[hookId];
  }
})()`;

  try {
    await frame.evaluate(cleanupScript);
    return {
      success: true,
      message: `浏览器端 Hook 数据已清理：${hookId}`,
      tooltype: 'remove_hook',
      hookId,
    };
  } catch (error) {
    return {
      success: false,
      message: `清理失败（页面可能已关闭）：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'remove_hook',
      hookId,
    };
  }
}
