/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookHistoryGo = defineTool({
  name: 'hook_history_go',
  description:
    '禁止历史导航：重写 window.history.go 和 window.history.back 方法以防止网站反调试返回上一页',
  aliases: ['hook-history'],
  annotations: {
    title: 'Hook history.go/back',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (
    _request: {params: Record<string, never>},
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const hookCode = `(function() {
  'use strict';
  window.history.go = function() {};
  window.history.back = function() {};
})();`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ history.go 和 history.back 已拦截');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
