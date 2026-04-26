/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * 禁止页面关闭：重写 window.close 方法以防止网站反调试关闭当前页面。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @returns 结构化结果对象
 */
export async function hookClose(frame: Frame): Promise<HookResult> {
  const hookCode = `(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_close',
  type: 'window',
  target: 'window.close',
})}
  window.close = function() {
    __pushHookRecord({
      event: 'close_blocked',
      blocked: true,
    });
  };
})();`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'window.close 已拦截',
      tooltype: 'hook_close',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_close',
    };
  }
}
