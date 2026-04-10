/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookJsonStringify = defineTool({
  name: 'hook_json_stringify',
  description: 'Hook JSON.stringify：监控 JSON 序列化操作',
  annotations: {
    title: 'Hook JSON Stringify',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
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
    request: {params: {showStack?: boolean; triggerDebugger?: boolean}},
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const {showStack, triggerDebugger} = request.params;

    const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const origStringify = JSON.stringify;

  JSON.stringify = function() {
    console.log('调用JSON.stringify，参数：\\n', ...arguments);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return origStringify.apply(this, arguments);
  };
  console.log('[hook_json_stringify] ✅ JSON.stringify hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ JSON Stringify Hook 已安装');
      response.appendResponseLine('- 所有 JSON.stringify 调用将被打印');
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
