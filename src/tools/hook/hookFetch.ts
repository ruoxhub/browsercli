/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookFetch = defineTool({
  name: 'hook_fetch',
  description: 'Hook window.fetch：监控 fetch API 调用，打印请求参数和堆栈',
  annotations: {
    title: 'Hook Fetch',
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
  const origFetch = window.fetch;

  window.fetch = function() {
    console.log('捕获到fetch请求：');
    for (let i = 0; i < arguments.length; i++) {
      console.log(arguments[i]);
    }
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return origFetch.apply(this, arguments);
  };
  window.fetch.__proto__ = origFetch.__proto__;
  console.log('[hook_fetch] ✅ Fetch hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Fetch Hook 已安装');
      response.appendResponseLine('- 所有 fetch 调用将被打印');
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
