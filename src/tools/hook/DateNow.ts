/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * Hook Date.now()：固定 Date.now() 的返回值，支持调用栈打印和 debugger 触发。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param fixedValue - 固定的返回值（毫秒时间戳），默认 0
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookDateNow(
  frame: Frame,
  fixedValue?: number,
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const value = fixedValue ?? 0;

  const hookCode = `
(function() {
  'use strict';
  const fixedValue = ${value};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
${buildHookStoreRuntime({
  hookId: 'hook_date_now',
  type: 'timer',
  target: 'Date.now',
  showStack,
  triggerDebugger,
})}

  Date.now = function() {
    __pushHookRecord({
      event: 'call',
      returnValue: fixedValue,
    });
    return fixedValue;
  };
  console.log('[hook_date_now] ✅ Date.now() fixed to ' + fixedValue);
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `Date.now() Hook 已安装，固定返回值：${value}`,
      tooltype: 'hook_date_now',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_date_now',
    };
  }
}
