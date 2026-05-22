/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook XMLHttpRequest.setRequestHeader：监控请求头设置，支持过滤特定 Header 名。
 */
export const hookXhrSetRequestHeader = defineTool({
  name: 'hook_xhr_set_request_header',
  description:
    'Hook XMLHttpRequest.setRequestHeader to monitor request header setting. Supports header name filtering.',
  annotations: {
    title: 'Hook XHR SetRequestHeader',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('Header name keywords to filter, empty means monitor all'),
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;
${buildHookStoreRuntime({
  hookId: 'hook_xhr_set_request_header',
  type: 'xhr',
  target: 'XMLHttpRequest.setRequestHeader',
  showStack,
  triggerDebugger,
})}

  function logAndPause(msg) {
    console.log(msg);
  }

  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function() {
    const header = arguments[0];
    const value = arguments[1];
    if (!hasFilter) {
      __pushHookRecord({
        event: 'set_request_header',
        header: typeof header === 'string' ? header : String(header || ''),
        value: __cloneHookValue(value),
      });
      logAndPause('请求头设置：' + header + ': ' + value);
    } else if (header && filterKeys.some(item => header.includes(item))) {
      __pushHookRecord({
        event: 'set_request_header',
        header,
        value: __cloneHookValue(value),
        matchedFilters: filterKeys.filter(item => header.includes(item)),
      });
      logAndPause('捕获到设置请求头 ---> ' + header + '\\n' + header + ': ' + value);
    }
    return origSetHeader.apply(this, arguments);
  };
  console.log('[hook_xhr_set_request_header] ✅ XHR setRequestHeader hook installed');
})();
`;

    try {
      await frame.evaluate(hookCode);
      getRuntime().hookManager.registerHook({
        hookId: 'hook_xhr_set_request_header',
        type: 'xhr',
        description: hasFilter
          ? `XHR SetRequestHeader Hook (filter: ${filterKeys!.join(', ')})`
          : 'XHR SetRequestHeader Hook (all)',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: hasFilter
          ? `XHR SetRequestHeader Hook 已安装，过滤 Header：${filterKeys!.join(', ')}`
          : 'XHR SetRequestHeader Hook 已安装，监控所有请求头设置',
        tooltype: 'hook_xhr_set_request_header',
        data: { hookId: 'hook_xhr_set_request_header' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_xhr_set_request_header',
        data: { hookId: 'hook_xhr_set_request_header' },
      });
    }
  },
});
