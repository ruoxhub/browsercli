/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * Hook JSON.stringify：监控 JSON 序列化操作。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookJsonStringify(
  frame: Frame,
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const origStringify = JSON.stringify;
${buildHookStoreRuntime({
  hookId: 'hook_json_stringify',
  type: 'json',
  target: 'JSON.stringify',
  showStack,
  triggerDebugger,
})}

  JSON.stringify = function() {
    __pushHookRecord({
      event: 'stringify',
      args: Array.from(arguments).map(__cloneHookValue),
    });
    console.log('调用JSON.stringify，参数：\\n', ...arguments);
    return origStringify.apply(this, arguments);
  };
  console.log('[hook_json_stringify] ✅ JSON.stringify hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'JSON Stringify Hook 已安装，所有 JSON.stringify 调用将被打印',
      tooltype: 'hook_json_stringify',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_json_stringify',
    };
  }
}
