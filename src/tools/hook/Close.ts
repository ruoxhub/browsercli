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
 * 禁止页面关闭：重写 window.close 方法以防止网站反调试关闭当前页面。
 */
export const hookClose = defineTool({
  name: 'hook_close',
  description: 'Block window.close to prevent anti-debugging page closure.',
  annotations: {
    title: 'Hook Close',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_close',
  type: 'window',
  target: 'window.close',
})}
  window.close = function() {
    __pushHookRecord({
      event: 'close_blocked',
      blocked: true,
    });
  };
})();`;

    try {
      await frame.evaluate(hookCode);
      getRuntime().hookManager.registerHook({
        hookId: 'hook_close',
        type: 'window',
        description: 'window.close Blocker',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: 'window.close 已拦截',
        tooltype: 'hook_close',
        data: { hookId: 'hook_close' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_close',
        data: { hookId: 'hook_close' },
      });
    }
  },
});
