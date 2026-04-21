/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * Hook Promise：监控 Promise resolve，打印 resolve 参数和调用栈，快速定位异步回调位置。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookPromise(
  frame: Frame,
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const __Promise = Promise;

  Promise = function Promise(callback) {
    if (!callback) {
      return new __Promise(callback);
    }
    const originCallback = callback;
    callback = function(resolve, reject) {
      const originResolve = resolve;
      resolve = function(result) {
        if (result && !(result instanceof Promise)) {
          console.groupCollapsed(result);
          console.trace();
          console.groupEnd();
          if (triggerDebugger) debugger;
          if (showStack) console.log(new Error().stack);
        }
        return originResolve.apply(this, arguments);
      };
      return originCallback(resolve, reject);
    };
    return new __Promise(callback);
  };
  Promise.prototype = __Promise.prototype;
  Object.defineProperties(Promise, Object.getOwnPropertyDescriptors(__Promise));
  console.log('[hook_promise] ✅ Promise hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'Promise Hook 已安装，Promise resolve 参数将被打印到控制台',
      tooltype: 'hook_promise',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_promise',
    };
  }
}
