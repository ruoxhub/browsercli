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
 * Hook XMLHttpRequest.open：监控 XHR 请求初始化，支持过滤特定 URL。
 */
export const hookXhrOpen = defineTool({
  name: 'hook_xhr_open',
  description:
    'Hook XMLHttpRequest.open to monitor XHR request initialization. Supports URL filtering.',
  annotations: {
    title: 'Hook XHR Open',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterUrls: zod
      .array(zod.string())
      .optional()
      .describe('URL keywords to filter, empty means monitor all'),
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {filterUrls, showStack, triggerDebugger} = request.params;
    const hasFilter = filterUrls && filterUrls.length > 0;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const filterUrls = ${JSON.stringify(filterUrls || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterUrls.length > 0;
${buildHookStoreRuntime({
  hookId: 'hook_xhr_open',
  type: 'xhr',
  target: 'XMLHttpRequest.open',
  showStack,
  triggerDebugger,
})}

  function logAndPause(msg) {
    console.log(msg);
  }

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function() {
    const method = arguments[0];
    const url = arguments[1];
    if (!hasFilter) {
      __pushHookRecord({
        event: 'open',
        method: typeof method === 'string' ? method.toUpperCase() : '',
        url: typeof url === 'string' ? url : String(url || ''),
      });
      logAndPause('初始化xhr请求：method ---> ' + method + ', url ---> ' + url);
    } else if (url && filterUrls.some(item => url.includes(item))) {
      __pushHookRecord({
        event: 'open',
        method: typeof method === 'string' ? method.toUpperCase() : '',
        url,
        matchedFilters: filterUrls.filter(item => url.includes(item)),
      });
      logAndPause('捕获到xhr请求 ---> url: ' + url + ' method: ' + method);
    }
    return origOpen.apply(this, arguments);
  };
  console.log('[hook_xhr_open] ✅ XHR open hook installed' + (hasFilter ? ' (filter: ' + filterUrls.join(', ') + ')' : ' (all)'));
})();
`;

    try {
      await frame.evaluate(hookCode);
      response.setStructuredContent({
        success: true,
        message: hasFilter
          ? `XHR Open Hook 已安装，过滤 URL：${filterUrls!.join(', ')}`
          : 'XHR Open Hook 已安装，监控所有 XHR 请求初始化',
        tooltype: 'hook_xhr_open',
        data: { hookId: 'hook_xhr_open' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_xhr_open',
        data: { hookId: 'hook_xhr_open' },
      });
    }
  },
});
