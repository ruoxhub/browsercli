/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {HookResult, StorageAction} from './types.js';

/**
 * Hook sessionStorage：监控 setItem/getItem/removeItem/clear 操作。
 *
 * @param frame - Puppeteer Frame 对象，用于注入 Hook 代码
 * @param actions - 要监控的操作类型，默认全部
 * @param filterKeys - 要过滤的特定键名
 * @param showStack - 是否打印调用栈
 * @param triggerDebugger - 触发时是否暂停
 * @returns 结构化结果对象
 */
export async function hookSessionStorage(
  frame: Frame,
  actions?: StorageAction[],
  filterKeys?: string[],
  showStack?: boolean,
  triggerDebugger?: boolean,
): Promise<HookResult> {
  const enabledActions = actions || ['setItem', 'getItem', 'removeItem', 'clear'];
  const hasFilter = filterKeys && filterKeys.length > 0;

  const hookCode = `
(function() {
  'use strict';
  const actions = ${JSON.stringify(enabledActions)};
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;

  function logAndPause(msg) {
    console.log(msg);
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
  }

  function matchesFilter(key) {
    if (!hasFilter) return true;
    return filterKeys.some(k => key.includes(k));
  }

  if (actions.includes('setItem')) {
    const orig = sessionStorage.setItem;
    sessionStorage.setItem = function(key, value) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('设置sessionStorage，键 ---> ' + key + ' 值 ---> ' + value);
      }
      return orig.call(this, key, value);
    };
  }

  if (actions.includes('getItem')) {
    const orig = sessionStorage.getItem;
    sessionStorage.getItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('读取sessionStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('removeItem')) {
    const orig = sessionStorage.removeItem;
    sessionStorage.removeItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('移除sessionStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('clear')) {
    const orig = sessionStorage.clear;
    sessionStorage.clear = function() {
      logAndPause('清空sessionStorage');
      return orig.call(this);
    };
  }

  console.log('[hook_session_storage] ✅ SessionStorage hook installed');
})();
`;

  try {
    await frame.evaluate(hookCode);
    return {
      success: true,
      message: `SessionStorage Hook 已安装，监控操作：${enabledActions.join(', ')}`,
      tooltype: 'hook_session_storage',
    };
  } catch (error) {
    return {
      success: false,
      message: `错误：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'hook_session_storage',
    };
  }
}
