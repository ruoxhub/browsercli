/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookXhrOpen = defineTool({
  name: 'hook_xhr_open',
  description:
    'Hook XMLHttpRequest.open：监控 XHR 请求初始化，支持过滤特定 URL',
  annotations: {
    title: 'Hook XHR Open',
    category: ToolCategory.HOOK,
    readOnlyHint: false,
  },
  schema: {
    filterUrls: zod
      .array(zod.string())
      .optional()
      .describe('要监控的特定 URL 列表，为空则监控全部'),
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

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function() {
    const method = arguments[0];
    const url = arguments[1];
    if (!hasFilter) {
      logAndPause('初始化xhr请求：method ---> ' + method + ', url ---> ' + url);
    } else if (url && filterUrls.some(item => url.includes(item))) {
      logAndPause('捕获到xhr请求 ---> url: ' + url + ' method: ' + method);
    }
    return origOpen.apply(this, arguments);
  };
  console.log('[hook_xhr_open] ✅ XHR open hook installed' + (hasFilter ? ' (filter: ' + filterUrls.join(', ') + ')' : ' (all)'));
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ XHR Open Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 URL：${filterUrls!.join(', ')}`
          : '- 监控所有 XHR 请求初始化',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
