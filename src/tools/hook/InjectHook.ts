/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 向页面注入 Hook 脚本。
 *
 * 将预生成的 Hook 脚本注入到当前 Frame 中执行，
 * Hook 将立即开始监控/拦截目标 API。
 */
export const injectHook = defineTool({
  name: 'inject_hook',
  description:
    'Inject an existing hook script into the current page. The hook will start monitoring/intercepting immediately.',
  annotations: {
    title: 'Inject Hook',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    hookId: zod.string().describe('Hook identifier for logging and tracking'),
    script: zod.string().describe('Hook script code to inject'),
  },
  handler: async (request, response, context) => {
    const {hookId, script} = request.params;
    const frame = (context as Context).getSelectedFrame();

    try {
      await frame.evaluate(script);
      response.setStructuredContent({
        success: true,
        message: `Hook injected: ${hookId}`,
        tooltype: 'inject_hook',
        data: {hookId},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `注入失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'inject_hook',
        data: {hookId},
      });
    }
  },
});