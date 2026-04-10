/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookRandom = defineTool({
  name: 'hook_random',
  description: 'Hook Math.random：固定 Math.random 的返回值',
  annotations: {
    title: 'Hook Random',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    fixedValue: zod.number().optional().default(0).describe('固定的返回值'),
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

  Math.random = function() {
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return fixedValue;
  };
  console.log('[hook_random] ✅ Math.random fixed to ' + fixedValue);
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Math.random Hook 已安装');
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
