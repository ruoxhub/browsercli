/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookClose = defineTool({
  name: 'hook_close',
  description:
    '禁止页面关闭：重写 window.close 方法以防止网站反调试关闭当前页面',
  aliases: ['hook-window-close'],
  annotations: {
    title: 'Hook window.close',
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
  window.close = function() {};
})();`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ window.close 已拦截');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
