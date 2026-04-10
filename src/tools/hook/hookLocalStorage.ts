/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookLocalStorage = defineTool({
  name: 'hook_local_storage',
  description:
    'Hook localStorage：监控 setItem/getItem/removeItem/clear 操作，支持过滤特定键',
  annotations: {
    title: 'Hook Local Storage',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    actions: zod
      .array(zod.enum(['setItem', 'getItem', 'removeItem', 'clear']))
      .optional()
      .describe('要监控的操作类型，默认全部'),
    filterKeys: zod.array(zod.string()).optional().describe('要过滤的特定键名'),
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
        actions?: Array<'setItem' | 'getItem' | 'removeItem' | 'clear'>;
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
    const {actions, filterKeys, showStack, triggerDebugger} = request.params;
    const enabledActions = actions || [
      'setItem',
      'getItem',
      'removeItem',
      'clear',
    ];
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
    const orig = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('设置localStorage，键 ---> ' + key + ' 值 ---> ' + value);
      }
      return orig.call(this, key, value);
    };
  }

  if (actions.includes('getItem')) {
    const orig = localStorage.getItem;
    localStorage.getItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('读取localStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('removeItem')) {
    const orig = localStorage.removeItem;
    localStorage.removeItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        logAndPause('移除localStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('clear')) {
    const orig = localStorage.clear;
    localStorage.clear = function() {
      logAndPause('清空localStorage');
      return orig.call(this);
    };
  }

  console.log('[hook_local_storage] ✅ LocalStorage hook installed (actions: ' + actions.join(', ') + ')');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ LocalStorage Hook 已安装');
      response.appendResponseLine(`- 监控操作：${enabledActions.join(', ')}`);
      if (hasFilter) {
        response.appendResponseLine(`- 过滤键：${filterKeys!.join(', ')}`);
      }
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
