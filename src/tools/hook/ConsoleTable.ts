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
 * Hook console.table：绕过通过 console.table 检测运行时间差的反调试。
 */
export const hookConsoleTable = defineTool({
  name: 'hook_console_table',
  description:
    'Neutralize console.table to bypass timing-based anti-debugging detection.',
  annotations: {
    title: 'Hook Console Table',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    enabled: zod
      .boolean()
      .optional()
      .describe('Whether to enable the hook, default true'),
  },
  handler: async (request, response, context) => {
    const {enabled} = request.params;
    const isEnabled = enabled !== false;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_console_table',
  type: 'console',
  target: 'console.table',
})}
${
  isEnabled
    ? `  console.table = function() {
    __pushHookRecord({
      event: 'table_blocked',
      blocked: true,
      args: Array.from(arguments).map(__cloneHookValue),
    });
  };
  console.log('[hook_console_table] ✅ console.table neutralized (anti-time-difference-debug)');`
    : `  __pushHookRecord({
    event: 'disabled',
  });
  console.log('[hook_console_table] ⚠️ hook disabled');`
}
})();
`;

    try {
      await frame.evaluate(hookCode);
      const result = {
        success: true,
        message: isEnabled
          ? 'Console Table Hook 已安装，console.table 已被置空，时间差检测将失效'
          : 'Console Table Hook 已禁用（enabled=false）',
        tooltype: 'hook_console_table',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_console_table',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
