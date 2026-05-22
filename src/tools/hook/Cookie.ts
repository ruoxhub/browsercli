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
 * Hook document.cookie：监控 Cookie 的读写操作，支持过滤特定 Cookie 名。
 */
export const hookCookie = defineTool({
  name: 'hook_cookie',
  description:
    'Hook document.cookie to monitor Cookie read/write operations. Supports filtering by cookie name.',
  annotations: {
    title: 'Hook Cookie',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('Cookie name keywords to filter, empty means monitor all'),
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
  hookId: 'hook_cookie',
  type: 'cookie',
  target: 'document.cookie',
  showStack,
  triggerDebugger,
})}

  function parseCookieNames(cookieStr) {
    if (!cookieStr || typeof cookieStr !== 'string') return [];
    const attrs = ['expires', 'max-age', 'domain', 'path', 'secure', 'httponly', 'samesite', 'partitioned', 'priority'];
    return cookieStr.split(';').map(p => p.trim()).filter(p => p.includes('=')).map(p => {
      const [name] = p.split('=');
      return decodeURIComponent(name.trim());
    }).filter(name => !attrs.includes(name.toLowerCase()));
  }

  function logAndPause(msg) {
    console.log(msg);
  }

  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  const originalGet = descriptor.get;
  const originalSet = descriptor.set;

  Object.defineProperty(document, 'cookie', {
    get: function() {
      const currentValue = originalGet.call(document);
      __pushHookRecord({
        event: 'get',
        cookie: currentValue,
      });
      return currentValue;
    },
    set: function(cookie) {
      if (!hasFilter) {
        __pushHookRecord({
          event: 'set',
          cookie,
          keys: parseCookieNames(cookie),
        });
        logAndPause('设置cookie：\\n' + cookie);
      } else {
        const keys = parseCookieNames(cookie);
        if (keys.length > 0 && filterKeys.some(k => keys[0].includes(k))) {
          __pushHookRecord({
            event: 'set',
            cookie,
            keys,
            matchedFilters: filterKeys.filter(k => keys[0].includes(k)),
          });
          logAndPause('捕获到设置cookie ---> ' + keys[0] + '\\n值：' + cookie);
        }
      }
      return originalSet.call(document, cookie);
    }
  });
  console.log('[hook_cookie] ✅ Cookie hook installed' + (hasFilter ? ' (filter: ' + filterKeys.join(', ') + ')' : ' (all)'));
})();
`;

    try {
      // 使用 <script> 元素注入，确保 hook 代码在页面主 world 执行
      // frame.evaluate() 在 Playwright 的隔离 utility world 中执行，
      // 导致 window.__hookStore 和 document.cookie 的属性覆盖对页面不可见
      await frame.evaluate((code: string) => {
        const scriptEl = document.createElement('script');
        scriptEl.textContent = code;
        (document.head || document.documentElement).appendChild(scriptEl);
        scriptEl.remove();
      }, hookCode);
      getRuntime().hookManager.registerHook({
        hookId: 'hook_cookie',
        type: 'cookie',
        description: hasFilter
          ? `Cookie Hook (filter: ${filterKeys!.join(', ')})`
          : 'Cookie Hook (all)',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: hasFilter
          ? `Cookie Hook 已安装，过滤 Cookie：${filterKeys!.join(', ')}`
          : 'Cookie Hook 已安装，监控所有 Cookie 操作',
        tooltype: 'hook_cookie',
        data: { hookId: 'hook_cookie' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_cookie',
        data: { hookId: 'hook_cookie' },
      });
    }
  },
});
