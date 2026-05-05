/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {evaluateInPageRuntime} from './evaluateInPageRuntime.js';

/**
 * 列出当前页面所有已安装的 Hook。
 */
export const listHooks = defineTool({
  name: 'list_hooks',
  description: 'Lists all active function hooks.',
  annotations: {
    title: '列出 Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    try {
      const frame = (context as Context).getSelectedFrame();
      const hooks = (await evaluateInPageRuntime<
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
      )) as Array<{id: string; target: string}>;

      if (!hooks || hooks.length === 0) {
        response.appendResponseLine('当前没有已安装的 Hook');
        return;
      }

      response.appendResponseLine(`活跃 Hook（${hooks.length} 个）:\n`);
      for (const hook of hooks) {
        response.appendResponseLine(`- ${hook.id}: ${hook.target}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
