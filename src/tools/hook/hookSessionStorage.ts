/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookSessionStorage = defineTool({
  name: 'hook_session_storage',
  description:
    'Hook sessionStorage：监控 setItem/getItem/removeItem/clear 操作',
  annotations: {
    title: 'Hook Session Storage',
    category: ToolCategory.HOOK,
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
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ SessionStorage Hook 已安装');
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
