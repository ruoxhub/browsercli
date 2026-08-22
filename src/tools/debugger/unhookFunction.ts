/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {evaluateAndRespond} from './evaluateAndRespond.js';
import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * 移除已安装的函数 Hook，恢复原始函数。
 */
export const unhookFunction = defineTool({
  name: 'unhook_function',
  description: '移除已安装的函数 Hook。',
  annotations: {
    title: 'Unhook Function',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod
      .string()
      .describe('要移除的 Hook ID（来自 hook_function）。'),
  },
  handler: async (request, response, context) => {
    const {hookId} = request.params;

    if (!hookId.trim()) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'hookId 参数不能为空。',
        {toolName: 'unhook_function'},
      );
    }

    await evaluateAndRespond<{error?: string}>({
      context: context as Context,
      response,
      tooltype: 'unhook_function',
      evaluate: frame =>
        evaluateInPageRuntime(
          frame,
          `
(function() {
  const hookId = ${JSON.stringify(hookId)};
  if (!window.__mcp_hooks__ || !window.__mcp_hooks__[hookId]) {
    return { error: 'Hook not found: ' + hookId };
  }

  const { obj, methodName, original } = window.__mcp_hooks__[hookId];
  obj[methodName] = original;
  delete window.__mcp_hooks__[hookId];

  return {};
})()
`,
        ),
      onSuccess: () => {
        response.setStructuredContent({
          success: true,
          message: `Hook "${hookId}" 已移除`,
          tooltype: 'unhook_function',
          data: {hookId},
        });
      },
      onEvaluateFail: () => {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Hook not found: ${hookId}`,
          {toolName: 'unhook_function', hookId},
        );
      },
    });
  },
});
