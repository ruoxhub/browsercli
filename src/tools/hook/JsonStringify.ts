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
 * Hook JSON.stringify：监控 JSON 序列化操作。
 */
export const hookJsonStringify = defineTool({
  name: 'hook_json_stringify',
  description: 'Hook JSON.stringify to monitor JSON serialization operations.',
  annotations: {
    title: 'Hook JSON.stringify',
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
      getRuntime().hookManager.registerHook({
        hookId: 'hook_json_stringify',
        type: 'json',
        description: 'JSON.stringify Hook',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: 'JSON Stringify Hook 已安装，所有 JSON.stringify 调用将被打印',
        tooltype: 'hook_json_stringify',
        data: { hookId: 'hook_json_stringify' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_json_stringify',
        data: { hookId: 'hook_json_stringify' },
      });
    }
  },
});
