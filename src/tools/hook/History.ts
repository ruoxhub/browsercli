/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {getRuntime} from '../../runtime.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook History API：监控 history.pushState/replaceState 操作，支持 URL 过滤。
 */
export const hookHistory = defineTool({
  name: 'hook_history',
  description:
    'Hook History API to monitor pushState/replaceState operations. Supports URL filtering.',
  annotations: {
    title: 'Hook History',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterUrls: zod
      .array(zod.string())
      .optional()
      .describe('URL keywords to filter'),
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
  hookId: 'hook_history',
  type: 'history',
  target: 'window.history',
  showStack,
  triggerDebugger,
})}

  function matchesFilter(url) {
    if (!hasFilter) return true;
    if (!url) return false;
    const urlStr = typeof url === 'string' ? url : String(url);
    return filterUrls.some(k => urlStr.includes(k));
  }

  function logAndPause(msg) {
    console.log(msg);
  }

  const origPushState = history.pushState;
  history.pushState = function(state, title, url) {
    if (!hasFilter || matchesFilter(url)) {
      __pushHookRecord({
        event: 'pushState',
        url: url ? String(url) : '',
        state: __cloneHookValue(state),
      });
      logAndPause('调用pushState ---> ' + (url || 'null') + ' | state: ' + JSON.stringify(state));
    }
    return origPushState.apply(this, arguments);
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (!hasFilter || matchesFilter(url)) {
      __pushHookRecord({
        event: 'replaceState',
        url: url ? String(url) : '',
        state: __cloneHookValue(state),
      });
      logAndPause('调用replaceState ---> ' + (url || 'null') + ' | state: ' + JSON.stringify(state));
    }
    return origReplaceState.apply(this, arguments);
  };

  console.log('[hook_history] ✅ History API hook installed');
})();
`;

    try {
      await frame.evaluate(hookCode);
      getRuntime().hookManager.registerHook({
        hookId: 'hook_history',
        type: 'history',
        description: hasFilter
          ? `History Hook (filter: ${filterUrls!.join(', ')})`
          : 'History Hook (all)',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: hasFilter
          ? `History API Hook 已安装，过滤 URL：${filterUrls!.join(', ')}`
          : 'History API Hook 已安装，监控所有 pushState/replaceState 调用',
        tooltype: 'hook_history',
        data: { hookId: 'hook_history' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_history',
        data: { hookId: 'hook_history' },
      });
    }
  },
});
