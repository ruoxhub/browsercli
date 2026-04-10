/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookPromise = defineTool({
  name: 'hook_promise',
  description:
    'Hook Promise：监控 Promise resolve，打印 resolve 参数和调用栈，快速定位异步回调位置',
  annotations: {
    title: 'Hook Promise',
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
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Promise Hook 已安装');
      response.appendResponseLine('- Promise resolve 参数将被打印到控制台');
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
