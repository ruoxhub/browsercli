/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookCookie = defineTool({
  name: 'hook_cookie',
  description:
    'Hook document.cookie：监控 Cookie 的读写操作，支持过滤特定 Cookie 名',
  annotations: {
    title: 'Hook Cookie',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要监控的特定 Cookie 名称列表，为空则监控全部'),
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
        filterKeys?: string[];
        showStack?: boolean;
        triggerDebugger?: boolean;
      };
    },
    response: Response,
    context: Context,
    _runtime,
  ) => {
    void _runtime;
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;

    const filterKeysJson = JSON.stringify(filterKeys || []);
    const showStackJson = JSON.stringify(!!showStack);
    const triggerDebuggerJson = JSON.stringify(!!triggerDebugger);

    const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${filterKeysJson};
  const showStack = ${showStackJson};
  const triggerDebugger = ${triggerDebuggerJson};
  const hasFilter = filterKeys.length > 0;

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
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  const originalGet = descriptor.get;
  const originalSet = descriptor.set;

  Object.defineProperty(document, 'cookie', {
    get: function() {
      return originalGet.call(document);
    },
    set: function(cookie) {
      if (!hasFilter) {
        logAndPause('设置cookie：\\n' + cookie);
      } else {
        const keys = parseCookieNames(cookie);
        if (keys.length > 0 && filterKeys.some(k => keys[0].includes(k))) {
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
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ Cookie Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 Cookie：${filterKeys!.join(', ')}`
          : '- 监控所有 Cookie 操作',
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
