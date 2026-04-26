/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * Hook window.fetch：监控 fetch API 调用，打印请求参数和堆栈。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookFetch(
  frame: Frame,
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const origFetch = window.fetch;
${buildHookStoreRuntime({
  hookId: 'hook_fetch',
  type: 'fetch',
  target: 'window.fetch',
  showStack,
  triggerDebugger,
})}

  window.fetch = function() {
    const args = Array.from(arguments);
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === 'string'
      ? input
      : input && typeof input.url === 'string'
        ? input.url
        : '';
    const method = typeof init.method === 'string'
      ? init.method
      : input && typeof input.method === 'string'
        ? input.method
        : 'GET';
    const body = init && Object.prototype.hasOwnProperty.call(init, 'body')
      ? __cloneHookValue(init.body)
      : undefined;
    const requestRecord = __pushHookRecord({
      event: 'request',
      method: String(method).toUpperCase(),
      url,
      body,
      args: args.map(__cloneHookValue),
    });
    console.log('捕获到fetch请求：', requestRecord);
    return origFetch.apply(this, arguments).then(function(response) {
      __pushHookRecord({
        event: 'response',
        method: String(method).toUpperCase(),
        url,
        status: response.status,
        statusText: response.statusText,
      });
      return response;
    }, function(error) {
      __pushHookRecord({
        event: 'error',
        method: String(method).toUpperCase(),
        url,
        error: error && error.message ? error.message : String(error),
      });
      throw error;
    });
  };
  window.fetch.__proto__ = origFetch.__proto__;
  console.log('[hook_fetch] ✅ Fetch hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: 'Fetch Hook 已安装，所有 fetch 调用将被打印',
      tooltype: 'hook_fetch',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_fetch',
    };
  }
}
