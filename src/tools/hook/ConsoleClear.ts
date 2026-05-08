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
 * 禁止清除控制台：重写 console.clear 方法以防止网站清空控制台数据。
 */
export const hookConsoleClear = defineTool({
  name: 'hook_console_clear',
  description:
    'Block console.clear to prevent websites from clearing the console.',
  annotations: {
    title: 'Hook Console Clear',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_console_clear',
  type: 'console',
  target: 'console.clear',
})}
  console.clear = function() {
    __pushHookRecord({
      event: 'clear_blocked',
      blocked: true,
    });
  };
})();`;

    try {
      await frame.evaluate(hookCode);
      getRuntime().hookManager.registerHook({
        hookId: 'hook_console_clear',
        type: 'console',
        description: 'console.clear Blocker',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: 'console.clear 已拦截',
        tooltype: 'hook_console_clear',
        data: { hookId: 'hook_console_clear' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_console_clear',
        data: { hookId: 'hook_console_clear' },
      });
    }
  },
});
