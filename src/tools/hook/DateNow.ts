/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook Date.now()：固定 Date.now() 的返回值，支持调用栈打印和 debugger 触发。
 */
export const hookDateNow = defineTool({
  name: 'hook_date_now',
  description:
    'Hook Date.now() to fix its return value. Useful for bypassing time-based anti-debugging.',
  annotations: {
    title: 'Hook Date.now',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    fixedValue: zod
      .number()
      .optional()
      .describe('Fixed return value in milliseconds, default 0'),
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {fixedValue, showStack, triggerDebugger} = request.params;
    const value = fixedValue ?? 0;
    const frame = (context as Context).getSelectedFrame();

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
      getRuntime().hookManager.registerHook({
        hookId: 'hook_date_now',
        type: 'timer',
        description: `Date.now Hook (fixed: ${value})`,
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: `Date.now() Hook 已安装，固定返回值：${value}`,
        tooltype: 'hook_date_now',
        data: { hookId: 'hook_date_now', fixedValue: value },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_date_now',
        data: { hookId: 'hook_date_now' },
      });
    }
  },
});
