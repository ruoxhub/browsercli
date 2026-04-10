/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookConsoleTable = defineTool({
  name: 'hook_console_table',
  description:
    'Hook console.table：绕过通过 console.table 检测运行时间差的反调试',
  annotations: {
    title: 'Hook Console Table',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {
    enabled: zod.boolean().optional().default(true).describe('是否启用'),
  },
  handler: async (
    request: {params: {enabled?: boolean}},
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const enabled = request.params.enabled !== false;

    const hookCode = `
(function() {
  'use strict';
${
  enabled
    ? `  console.table = function() {};
  console.log('[hook_console_table] ✅ console.table neutralized (anti-time-difference-debug)');`
    : `  console.log('[hook_console_table] ⚠️ hook disabled');`
}
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Console Table Hook 已安装');
      response.appendResponseLine(
        enabled
          ? '- console.table 已被置空，时间差检测将失效'
          : '- 已禁用（enabled=false）',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
