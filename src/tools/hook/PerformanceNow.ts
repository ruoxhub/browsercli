/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook performance.now()：固定返回值，支持调用栈打印和 debugger 触发。
 */
export const hookPerformanceNow = defineTool({
  name: 'hook_performance_now',
  description:
    'Hook performance.now() to fix its return value. Useful for bypassing timing-based anti-debugging.',
  annotations: {
    title: 'Hook performance.now',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    fixedValue: zod
      .number()
      .optional()
      .describe('Fixed return value, default 0'),
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
  hookId: 'hook_performance_now',
  type: 'timer',
  target: 'performance.now',
  showStack,
  triggerDebugger,
})}

  performance.now = function() {
    __pushHookRecord({
      event: 'call',
      returnValue: fixedValue,
    });
    return fixedValue;
  };
  console.log('[hook_performance_now] ✅ performance.now() fixed to ' + fixedValue);
})();
`;

    try {
      await frame.evaluate(hookCode);
      const result = {
        success: true,
        message: `performance.now() Hook 已安装，固定返回值：${value}`,
        tooltype: 'hook_performance_now',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_performance_now',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
