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
 * 禁止历史导航：重写 window.history.go 和 window.history.back 方法以防止网站反调试返回上一页。
 */
export const hookHistoryGo = defineTool({
  name: 'hook_history_go',
  description:
    'Block history.go and history.back to prevent anti-debugging page navigation.',
  annotations: {
    title: 'Hook History Go',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response, context) => {
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_history_go',
  type: 'history',
  target: 'window.history.go',
})}
  window.history.go = function(delta) {
    __pushHookRecord({
      event: 'go_blocked',
      delta: typeof delta === 'number' ? delta : undefined,
    });
  };
  window.history.back = function() {
    __pushHookRecord({
      event: 'back_blocked',
    });
  };
})();`;

    try {
      await frame.evaluate(hookCode);
      response.setStructuredContent({
        success: true,
        message: 'history.go 和 history.back 已拦截',
        tooltype: 'hook_history_go',
        data: { hookId: 'hook_history_go' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_history_go',
        data: { hookId: 'hook_history_go' },
      });
    }
  },
});
