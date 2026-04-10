/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookWebSocket = defineTool({
  name: 'hook_websocket',
  description:
    'Hook WebSocket：监控 WebSocket 连接、消息收发操作，支持按 URL 过滤',
  annotations: {
    title: 'Hook WebSocket',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterUrls: zod
      .array(zod.string())
      .optional()
      .describe('要过滤的 WebSocket URL 关键字'),
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
  const __WS = window.WebSocket;

  function matchesFilter(url) {
    if (!hasFilter) return true;
    return filterUrls.some(k => url.includes(k));
  }

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  window.WebSocket = function(url, protocols) {
    if (!hasFilter || matchesFilter(url)) {
      logAndPause('创建WebSocket连接 ---> ' + url + (protocols ? ' (protocols: ' + JSON.stringify(protocols) + ')' : ''));
    }
    if (protocols !== undefined) {
      return new __WS(url, protocols);
    }
    return new __WS(url);
  };

  window.WebSocket.prototype = __WS.prototype;
  Object.defineProperties(window.WebSocket, Object.getOwnPropertyDescriptors(__WS));

  const origSend = __WS.prototype.send;
  __WS.prototype.send = function(data) {
    if (!hasFilter || matchesFilter(this.url || '')) {
      logAndPause('WebSocket发送消息 ---> ' + (typeof data === 'string' ? data : '[Binary]'));
    }
    return origSend.apply(this, arguments);
  };

  const origAddEventListener = __WS.prototype.addEventListener;
  __WS.prototype.addEventListener = function(event, handler) {
    if (event === 'message' && (!hasFilter || matchesFilter(this.url || ''))) {
      const wrapped = function(e) {
        logAndPause('WebSocket收到消息 ---> ' + (typeof e.data === 'string' ? e.data : '[Binary]'));
        return handler.apply(this, arguments);
      };
      return origAddEventListener.call(this, event, wrapped);
    }
    return origAddEventListener.apply(this, arguments);
  };

  console.log('[hook_websocket] ✅ WebSocket hook installed' + (hasFilter ? ' (filter: ' + filterUrls.join(', ') + ')' : ' (all)'));
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ WebSocket Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 URL：${filterUrls!.join(', ')}`
          : '- 监控所有 WebSocket 操作',
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
