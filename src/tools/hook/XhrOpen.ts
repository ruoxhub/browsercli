/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult, LogFormat} from './types.js';

/**
 * Hook XMLHttpRequest.open：监控 XHR 请求初始化，支持过滤特定 URL。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param filterUrls - 要监控的特定 URL 列表，为空则监控全部
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookXhrOpen(
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
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: hasFilter
        ? `XHR Open Hook 已安装，过滤 URL：${filterUrls!.join(', ')}`
        : 'XHR Open Hook 已安装，监控所有 XHR 请求初始化',
      tooltype: 'hook_xhr_open',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_xhr_open',
    };
  }
}
