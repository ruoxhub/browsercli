/**
 * @license`
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * 移除已安装的函数 Hook，恢复原始函数。
 */
export const unhookFunction = defineTool({
  name: 'unhook_function',
  description: 'Removes a previously installed function hook.',
  annotations: {
    title: 'Unhook Function',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod
      .string()
      .describe('The hook ID to remove (from hook_function).'),
  },
  handler: async (request, response, context) => {
    const hookId = request.params.hookId;

    if (!hookId) {
      response.appendResponseLine('hookId 参数不能为空');
      return;
    }

    try {
      const frame = (context as Context).getSelectedFrame();
      if (!frame) {
        response.appendResponseLine('当前没有可用的页面或 Frame');
        return;
      }

      const result = await evaluateInPageRuntime(
        frame,
        `
(function() {
  const hookId = ${JSON.stringify(hookId)};
  if (!window.__mcp_hooks__ || !window.__mcp_hooks__[hookId]) {
    return { success: false, message: 'Hook not found: ' + hookId };
  }

  const { obj, methodName, original } = window.__mcp_hooks__[hookId];
  obj[methodName] = original;
  delete window.__mcp_hooks__[hookId];

  return { success: true };
})()
`,
      );

      if (result && typeof result === 'object') {
        const r = result as {success: boolean; message?: string};
        if (r.success) {
          response.appendResponseLine(`✅ Hook "${hookId}" 已移除`);
        } else {
          response.appendResponseLine(`❌ ${r.message}`);
        }
      }
    } catch (error) {
      response.appendResponseLine(
        `错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
