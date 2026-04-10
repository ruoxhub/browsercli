/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookDateNow = defineTool({
  name: 'hook_date_now',
  description:
    'Hook Date.now()：固定 Date.now() 的返回值，支持调用栈打印和 debugger 触发',
  annotations: {
    title: 'Hook Date Now',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {
    fixedValue: zod
      .number()
      .optional()
      .default(0)
      .describe('固定的返回值（毫秒时间戳）'),
    showStack: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否打印调用栈'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .default(false)
      .describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {
        fixedValue?: number;
        showStack?: boolean;
        triggerDebugger?: boolean;
      };
    },
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const {fixedValue, showStack, triggerDebugger} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const fixedValue = ${fixedValue};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};

  Date.now = function() {
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return fixedValue;
  };
  console.log('[hook_date_now] ✅ Date.now() fixed to ' + fixedValue);
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Date.now() Hook 已安装');
      response.appendResponseLine(`- 固定返回值：${fixedValue}`);
      if (showStack) response.appendResponseLine('- 已启用调用栈打印');
      if (triggerDebugger)
        response.appendResponseLine('- 已启用 debugger 断点');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
