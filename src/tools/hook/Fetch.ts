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

    // 注入后尝试读取当前状态（验证 Hook 是否激活）
    let recordCount = 0;
    try {
      recordCount = (await frame.evaluate(() => {
        const store = (window as any).__hookStore;
        if (!store) return 0;
        const records = store['hook_fetch'];
        return Array.isArray(records) ? records.length : 0;
      })) as number;
    } catch {
      // 状态读取失败不影响主流程
    }

    return {
      success: true,
      message:
        `Fetch Hook 已注入页面。当前已捕获 ${recordCount} 条记录。` +
        (recordCount === 0
          ? ' 注意：页面加载前的请求无法回溯捕获，请刷新页面或触发新的 fetch 请求。'
          : ''),
      tooltype: 'hook_fetch',
      data: {
        hookId: 'hook_fetch',
        status: 'active',
        recordCount,
        note: '后续 fetch 调用将被自动捕获并存储在 window.__hookStore.hook_fetch',
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Fetch Hook 注入失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_fetch',
      data: {
        hookId: 'hook_fetch',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
