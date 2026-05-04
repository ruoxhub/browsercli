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
 * Hook Math.random：固定 Math.random 的返回值。
 */
export const hookRandom = defineTool({
  name: 'hook_random',
  description:
    'Hook Math.random to fix its return value. Useful for bypassing random-based anti-debugging.',
  annotations: {
    title: 'Hook Math.random',
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
  hookId: 'hook_random',
  type: 'timer',
  target: 'Math.random',
  showStack,
  triggerDebugger,
})}

  Math.random = function() {
    __pushHookRecord({
      event: 'call',
      returnValue: fixedValue,
    });
    return fixedValue;
  };
  console.log('[hook_random] ✅ Math.random fixed to ' + fixedValue);
})();
`;

    try {
      await frame.evaluate(hookCode);
      const result = {
        success: true,
        message: `Math.random Hook 已安装，固定返回值：${value}`,
        tooltype: 'hook_random',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_random',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
