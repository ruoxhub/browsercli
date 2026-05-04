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
 * Hook location.href：阻断页面跳转，触发 debugger 以定位跳转代码位置。
 */
export const hookLocationHref = defineTool({
  name: 'hook_location_href',
  description:
    'Block page navigation by hooking onbeforeunload. Useful for preventing anti-debugging redirects.',
  annotations: {
    title: 'Hook Location Href',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on navigation, default true'),
  },
  handler: async (request, response, context) => {
    const {triggerDebugger} = request.params;
    const shouldDebug = triggerDebugger !== false;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
${buildHookStoreRuntime({
  hookId: 'hook_location_href',
  type: 'location',
  target: 'window.onbeforeunload',
  triggerDebugger: shouldDebug,
})}
  window.onbeforeunload = function() {
    __pushHookRecord({
      event: 'beforeunload',
      blocked: true,
      url: window.location.href,
    });
    console.log('[hook_location_href] ⛔ Page navigation blocked');
    return false;
  };
  console.log('[hook_location_href] ✅ Navigation blocker installed');
})();
`;

    try {
      await frame.evaluate(hookCode);
      const result = {
        success: true,
        message: `Location Href Hook 已安装，页面跳转将被阻断${shouldDebug ? '，并触发 debugger 断点' : ''}`,
        tooltype: 'hook_location_href',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_location_href',
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
