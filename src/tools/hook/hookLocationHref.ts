/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookLocationHref = defineTool({
  name: 'hook_location_href',
  description:
    'Hook location.href：阻断页面跳转，触发 debugger 以定位跳转代码位置',
  annotations: {
    title: 'Hook Location Href',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    triggerDebugger: zod
      .boolean()
      .optional()
      .default(true)
      .describe('跳转时是否触发 debugger 断点'),
  },
  handler: async (
    request: {params: {triggerDebugger?: boolean}},
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const triggerDebugger = request.params.triggerDebugger !== false;

    const hookCode = `
(function() {
  'use strict';
  window.onbeforeunload = function() {
    ${triggerDebugger ? 'debugger;' : ''}
    console.log('[hook_location_href] ⛔ Page navigation blocked');
    return false;
  };
  console.log('[hook_location_href] ✅ Navigation blocker installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Location Href Hook 已安装');
      response.appendResponseLine(
        '- 页面跳转将被阻断' +
          (triggerDebugger ? '，并触发 debugger 断点' : ''),
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
