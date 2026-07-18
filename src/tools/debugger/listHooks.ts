/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {getFrameOrRespond} from './evaluateAndRespond.js';
import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * 列出当前页面所有已安装的 Hook。
 */
export const listHooks = defineTool({
  name: 'list_hooks',
  description: '列出当前所有已安装的函数 Hook。',
  annotations: {
    title: '列出 Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    const frame = getFrameOrRespond(context as Context, response, 'list_hooks');
    if (!frame) return;

    try {
      const hooks = await evaluateInPageRuntime<
        Array<{id: string; target: string}>
      >(
        frame,
        `
(function() {
  if (!window.__mcp_hooks__) return [];
  return Object.keys(window.__mcp_hooks__).map(id => {
    const hook = window.__mcp_hooks__[id];
    return { id, target: hook.obj.constructor.name + '.' + hook.methodName };
  });
})()
`,
      );

      if (!Array.isArray(hooks)) {
        response.setStructuredContent({
          success: false,
          message: 'list_hooks 返回格式异常',
          tooltype: 'list_hooks',
          data: {},
        });
        return;
      }

      response.setStructuredContent({
        success: true,
        message: hooks.length
          ? `活跃 Hook（${hooks.length} 个）`
          : '当前没有已安装的 Hook',
        tooltype: 'list_hooks',
        data: {hooks},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_hooks',
        data: {},
      });
    }
  },
});
