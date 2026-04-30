/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import {buildHookStoreRuntime} from './store-utils.js';
import type {HookResult} from './types.js';

/**
 * Hook JSON.parse：监控 JSON 解析操作，支持过滤特定字符串。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param filterKeys - 要过滤的特定 JSON 字符串内容
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookJsonParse(
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
  const origParse = JSON.parse;
${buildHookStoreRuntime({
  hookId: 'hook_json_parse',
  type: 'json',
  target: 'JSON.parse',
  showStack,
  triggerDebugger,
})}

  JSON.parse = function() {
    const source = arguments[0];
    if (!hasFilter) {
      __pushHookRecord({
        event: 'parse',
        input: typeof source === 'string' ? source : __cloneHookValue(source),
      });
      console.log('调用JSON.parse ---> ', source);
    } else if (source && typeof source === 'string' && filterKeys.some(item => source.includes(item))) {
      __pushHookRecord({
        event: 'parse',
        input: source,
        matchedFilters: filterKeys.filter(item => source.includes(item)),
      });
      console.log('捕获到JSON.parse指定字符串 ---> ', source);
    } else {
      return origParse.apply(this, arguments);
    }
    return origParse.apply(this, arguments);
  };
  console.log('[hook_json_parse] ✅ JSON.parse hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: hasFilter
        ? `JSON Parse Hook 已安装，过滤字符串：${filterKeys!.join(', ')}`
        : 'JSON Parse Hook 已安装，监控所有 JSON.parse 调用',
      tooltype: 'hook_json_parse',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_json_parse',
    };
  }
}
