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
 * Hook window.fetch：监控 fetch API 调用，打印请求参数和堆栈。
 */
export const hookFetch = defineTool({
  name: 'hook_fetch',
  description:
    'Hook window.fetch to monitor fetch API calls, logging request parameters and stack traces. Supports optional --url filter.',
  annotations: {
    title: 'Hook Fetch',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    url: zod
      .string()
      .optional()
      .describe('URL 子串过滤 — 只 hook URL 包含此字符串的 fetch 请求（子串匹配，非精确匹配）'),
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {url: urlFilter, showStack, triggerDebugger} = request.params;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const urlFilter = ${JSON.stringify(urlFilter ?? '')};
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
    if (urlFilter && !url.includes(urlFilter)) {
      return origFetch.apply(this, arguments);
    }
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

      getRuntime().hookManager.registerHook({
        hookId: 'hook_fetch',
        type: 'fetch',
        description: 'Fetch Hook',
        script: hookCode,
      });

      response.setStructuredContent({
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
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Fetch Hook 注入失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_fetch',
        data: {
          hookId: 'hook_fetch',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
});
