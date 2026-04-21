/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * Hook History API：监控 history.pushState/replaceState 操作，支持 URL 过滤。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param filterUrls - 要过滤的 URL 关键字
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookHistory(
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

  function matchesFilter(url) {
    if (!hasFilter) return true;
    if (!url) return false;
    const urlStr = typeof url === 'string' ? url : String(url);
    return filterUrls.some(k => urlStr.includes(k));
  }

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const origPushState = history.pushState;
  history.pushState = function(state, title, url) {
    if (!hasFilter || matchesFilter(url)) {
      logAndPause('调用pushState ---> ' + (url || 'null') + ' | state: ' + JSON.stringify(state));
    }
    return origPushState.apply(this, arguments);
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (!hasFilter || matchesFilter(url)) {
      logAndPause('调用replaceState ---> ' + (url || 'null') + ' | state: ' + JSON.stringify(state));
    }
    return origReplaceState.apply(this, arguments);
  };

  console.log('[hook_history] ✅ History API hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: hasFilter
        ? `History API Hook 已安装，过滤 URL：${filterUrls!.join(', ')}`
        : 'History API Hook 已安装，监控所有 pushState/replaceState 调用',
      tooltype: 'hook_history',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_history',
    };
  }
}
