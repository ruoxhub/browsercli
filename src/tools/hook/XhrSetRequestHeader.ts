/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult} from './types.js';

/**
 * Hook XMLHttpRequest.setRequestHeader：监控请求头设置，支持过滤特定 Header 名。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param filterKeys - 要监控的特定 Header 名称
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookXhrSetRequestHeader(
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

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function() {
    const header = arguments[0];
    const value = arguments[1];
    if (!hasFilter) {
      logAndPause('请求头设置：' + header + ': ' + value);
    } else if (header && filterKeys.some(item => header.includes(item))) {
      logAndPause('捕获到设置请求头 ---> ' + header + '\\n' + header + ': ' + value);
    }
    return origSetHeader.apply(this, arguments);
  };
  console.log('[hook_xhr_set_request_header] ✅ XHR setRequestHeader hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: hasFilter
        ? `XHR SetRequestHeader Hook 已安装，过滤 Header：${filterKeys!.join(', ')}`
        : 'XHR SetRequestHeader Hook 已安装，监控所有请求头设置',
      tooltype: 'hook_xhr_set_request_header',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_xhr_set_request_header',
    };
  }
}
