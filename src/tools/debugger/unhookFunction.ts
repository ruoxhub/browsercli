/**
 * @license`
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

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

    if (!hookId || typeof hookId !== 'string' || hookId.trim() === '') {
      response.setStructuredContent({
        success: false,
        message: "hookId 参数不能为空。",
        tooltype: 'unhook_function',
        data: {}
      });
      return;
    }

    try {
      const frame = (context as Context).getSelectedFrame();
      if (!frame) {
        response.setStructuredContent({
          success: false,
          message: '当前没有可用的页面或 Frame',
          tooltype: 'unhook_function',
          data: {}
        });
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
          response.setStructuredContent({
            success: true,
            message: `Hook "${hookId}" 已移除`,
            tooltype: 'unhook_function',
            data: { hookId }
          });
        } else {
          response.setStructuredContent({
            success: false,
            message: r.message || 'Hook 移除失败',
            tooltype: 'unhook_function',
            data: { hookId }
          });
        }
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'unhook_function',
        data: { hookId: request.params.hookId }
      });
    }
  },
});
