/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * Hook WebSocket：监控 WebSocket 连接、消息收发操作，支持按 URL 过滤。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param filterUrls - 要过滤的 WebSocket URL 关键字
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookWebSocket(
  frame: Frame,
  filterUrls?: string[],
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const hasFilter = filterUrls && filterUrls.length > 0;

  const hookCode = `
(function() {
  'use strict';
  const filterUrls = ${JSON.stringify(filterUrls || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterUrls.length > 0;
  const __WS = window.WebSocket;
${buildHookStoreRuntime({
  hookId: 'hook_websocket',
  type: 'websocket',
  target: 'window.WebSocket',
  showStack,
  triggerDebugger,
})}

  function matchesFilter(url) {
    if (!hasFilter) return true;
    return filterUrls.some(k => url.includes(k));
  }

  function logAndPause(msg) {
    console.log(msg);
  }

  window.WebSocket = function(url, protocols) {
    if (!hasFilter || matchesFilter(url)) {
      __pushHookRecord({
        event: 'connect',
        url,
        protocols: __cloneHookValue(protocols),
      });
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
      __pushHookRecord({
        event: 'send',
        url: this.url || '',
        data: typeof data === 'string' ? data : '[Binary]',
      });
      logAndPause('WebSocket发送消息 ---> ' + (typeof data === 'string' ? data : '[Binary]'));
    }
    return origSend.apply(this, arguments);
  };

  const origAddEventListener = __WS.prototype.addEventListener;
  __WS.prototype.addEventListener = function(event, handler) {
    if (event === 'message' && (!hasFilter || matchesFilter(this.url || ''))) {
      const wrapped = function(e) {
        __pushHookRecord({
          event: 'message',
          url: this && this.url ? this.url : '',
          data: e && typeof e.data === 'string' ? e.data : '[Binary]',
        });
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
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: hasFilter
        ? `WebSocket Hook 已安装，过滤 URL：${filterUrls!.join(', ')}`
        : 'WebSocket Hook 已安装，监控所有 WebSocket 操作',
      tooltype: 'hook_websocket',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_websocket',
    };
  }
}
