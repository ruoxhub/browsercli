/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook localStorage：监控 setItem/getItem/removeItem/clear 操作，支持过滤特定键。
 */
export const hookLocalStorage = defineTool({
  name: 'hook_local_storage',
  description:
    'Hook localStorage to monitor setItem/getItem/removeItem/clear operations. Supports key filtering.',
  annotations: {
    title: 'Hook LocalStorage',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    actions: zod
      .array(zod.enum(['setItem', 'getItem', 'removeItem', 'clear']))
      .optional()
      .describe('Actions to monitor, default all'),
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('Key name keywords to filter'),
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {actions, filterKeys, showStack, triggerDebugger} = request.params;
    const enabledActions = actions || [
      'setItem',
      'getItem',
      'removeItem',
      'clear',
    ];
    const hasFilter = filterKeys && filterKeys.length > 0;
    const frame = (context as Context).getSelectedFrame();

    const hookCode = `
(function() {
  'use strict';
  const actions = ${JSON.stringify(enabledActions)};
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;
${buildHookStoreRuntime({
  hookId: 'hook_local_storage',
  type: 'storage',
  target: 'window.localStorage',
  showStack,
  triggerDebugger,
})}

  function logAndPause(msg) {
    console.log(msg);
  }

  function matchesFilter(key) {
    if (!hasFilter) return true;
    return filterKeys.some(k => key.includes(k));
  }

  if (actions.includes('setItem')) {
    const orig = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      if (!hasFilter || matchesFilter(key)) {
        __pushHookRecord({
          event: 'setItem',
          key,
          value,
        });
        logAndPause('设置localStorage，键 ---> ' + key + ' 值 ---> ' + value);
      }
      return orig.call(this, key, value);
    };
  }

  if (actions.includes('getItem')) {
    const orig = localStorage.getItem;
    localStorage.getItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        __pushHookRecord({
          event: 'getItem',
          key,
        });
        logAndPause('读取localStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('removeItem')) {
    const orig = localStorage.removeItem;
    localStorage.removeItem = function(key) {
      if (!hasFilter || matchesFilter(key)) {
        __pushHookRecord({
          event: 'removeItem',
          key,
        });
        logAndPause('移除localStorage，键 ---> ' + key);
      }
      return orig.call(this, key);
    };
  }

  if (actions.includes('clear')) {
    const orig = localStorage.clear;
    localStorage.clear = function() {
      __pushHookRecord({
        event: 'clear',
      });
      logAndPause('清空localStorage');
      return orig.call(this);
    };
  }

  console.log('[hook_local_storage] ✅ LocalStorage hook installed (actions: ' + actions.join(', ') + ')');
})();
`;

    try {
      await frame.evaluate(hookCode);
      response.setStructuredContent({
        success: true,
        message: `LocalStorage Hook 已安装，监控操作：${enabledActions.join(', ')}`,
        tooltype: 'hook_local_storage',
        data: { hookId: 'hook_local_storage', enabledActions },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_local_storage',
        data: { hookId: 'hook_local_storage' },
      });
    }
  },
});
