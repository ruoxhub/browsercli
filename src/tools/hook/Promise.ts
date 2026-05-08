/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {getRuntime} from '../../runtime.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook Promise：监控 Promise resolve，打印 resolve 参数和调用栈，快速定位异步回调位置。
 */
export const hookPromise = defineTool({
  name: 'hook_promise',
  description:
    'Hook Promise to monitor resolve calls, printing resolve arguments and call stacks for quick async callback location.',
  annotations: {
    title: 'Hook Promise',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {showStack, triggerDebugger} = request.params;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const __Promise = Promise;
${buildHookStoreRuntime({
  hookId: 'hook_promise',
  type: 'promise',
  target: 'Promise',
  showStack,
  triggerDebugger,
})}

  Promise = function Promise(callback) {
    if (!callback) {
      return new __Promise(callback);
    }
    const originCallback = callback;
    callback = function(resolve, reject) {
      const originResolve = resolve;
      resolve = function(result) {
        if (result && !(result instanceof Promise)) {
          __pushHookRecord({
            event: 'resolve',
            result: __cloneHookValue(result),
          });
          console.groupCollapsed(result);
          console.trace();
          console.groupEnd();
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
      getRuntime().hookManager.registerHook({
        hookId: 'hook_promise',
        type: 'promise',
        description: 'Promise Hook',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: 'Promise Hook 已安装，Promise resolve 参数将被打印到控制台',
        tooltype: 'hook_promise',
        data: { hookId: 'hook_promise' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_promise',
        data: { hookId: 'hook_promise' },
      });
    }
  },
});
