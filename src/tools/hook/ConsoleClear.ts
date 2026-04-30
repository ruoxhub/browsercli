/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * 禁止清除控制台：重写 console.clear 方法以防止网站清空控制台数据。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @returns 结构化结果对象
 */
export async function hookConsoleClear(frame: Frame): Promise<HookResult> {
  const hookCode = `(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_console_clear',
  type: 'console',
  target: 'console.clear',
})}
  console.clear = function() {
    __pushHookRecord({
      event: 'clear_blocked',
      blocked: true,
    });
  };
})();`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'console.clear 已拦截',
      tooltype: 'hook_console_clear',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_console_clear',
    };
  }
}
