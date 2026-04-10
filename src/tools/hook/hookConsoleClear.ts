/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookConsoleClear = defineTool({
  name: 'hook_console_clear',
  description:
    '禁止清除控制台：重写 console.clear 方法以防止网站清空控制台数据',
  aliases: ['hook-console-clear'],
  annotations: {
    title: 'Hook console.clear',
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
  console.clear = function() {};
})();`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ console.clear 已拦截');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
