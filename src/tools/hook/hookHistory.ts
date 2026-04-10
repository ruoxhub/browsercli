/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookHistory = defineTool({
  name: 'hook_history',
  description:
    'Hook History API：监控 history.pushState/replaceState 操作，支持 URL 过滤',
  annotations: {
    title: 'Hook History API',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {
    filterUrls: zod
      .array(zod.string())
      .optional()
      .describe('要过滤的 URL 关键字'),
    showStack: zod
      .boolean()
      .optional()
      .default(false)
      .describe('是否打印调用栈'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .default(false)
      .describe('触发时是否暂停'),
  },
  handler: async (
    request: {
      params: {
        filterUrls?: string[];
        showStack?: boolean;
        triggerDebugger?: boolean;
      };
    },
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const {filterUrls, showStack, triggerDebugger} = request.params;
    const hasFilter = filterUrls && filterUrls.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const filterUrls = ${JSON.stringify(filterUrls || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterUrls.length > 0;

  function matchesFilter(url) {
    if (!hasFilter) return true;
    if (!url) return false;
    const urlStr = typeof url === 'string' ? url : String(url);
    return filterUrls.some(k => urlStr.includes(k));
  }

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const origPushState = history.pushState;
  history.pushState = function(state, title, url) {
    if (!hasFilter || matchesFilter(url)) {
      logAndPause('调用pushState ---> ' + (url || 'null') + ' | state: ' + JSON.stringify(state));
    }
    return origPushState.apply(this, arguments);
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (!hasFilter || matchesFilter(url)) {
      logAndPause('调用replaceState ---> ' + (url || 'null') + ' | state: ' + JSON.stringify(state));
    }
    return origReplaceState.apply(this, arguments);
  };

  console.log('[hook_history] ✅ History API hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ History API Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 URL：${filterUrls!.join(', ')}`
          : '- 监控所有 pushState/replaceState 调用',
      );
      if (showStack) response.appendResponseLine('- 已启用调用栈打印');
      if (triggerDebugger)
        response.appendResponseLine('- 已启用 debugger 断点');
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
