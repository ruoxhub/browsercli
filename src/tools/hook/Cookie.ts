/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * Hook document.cookie：监控 Cookie 的读写操作，支持过滤特定 Cookie 名。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param filterKeys - 要监控的特定 Cookie 名称列表，为空则监控全部
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookCookie(
  frame: Frame,
  filterKeys?: string[],
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const hasFilter = filterKeys && filterKeys.length > 0;

  const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
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
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: hasFilter
        ? `Cookie Hook 已安装，过滤 Cookie：${filterKeys!.join(', ')}`
        : 'Cookie Hook 已安装，监控所有 Cookie 操作',
      tooltype: 'hook_cookie',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_cookie',
    };
  }
}
