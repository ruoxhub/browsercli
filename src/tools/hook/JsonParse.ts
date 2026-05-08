/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {getRuntime} from '../../runtime.js';

import {buildHookStoreRuntime} from './store-utils.js';

/**
 * Hook JSON.parse：监控 JSON 解析操作，支持过滤特定字符串。
 */
export const hookJsonParse = defineTool({
  name: 'hook_json_parse',
  description:
    'Hook JSON.parse to monitor JSON parsing operations. Supports content filtering.',
  annotations: {
    title: 'Hook JSON.parse',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('Content keywords to filter, empty means monitor all'),
    showStack: zod.boolean().optional().describe('Whether to print call stack'),
    triggerDebugger: zod
      .boolean()
      .optional()
      .describe('Whether to trigger debugger on hit'),
  },
  handler: async (request, response, context) => {
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;
    const frame = (context as Context).getSelectedFrame();

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
      getRuntime().hookManager.registerHook({
        hookId: 'hook_json_parse',
        type: 'json',
        description: hasFilter
          ? `JSON.parse Hook (filter: ${filterKeys!.join(', ')})`
          : 'JSON.parse Hook (all)',
        script: hookCode,
      });
      response.setStructuredContent({
        success: true,
        message: hasFilter
          ? `JSON Parse Hook 已安装，过滤字符串：${filterKeys!.join(', ')}`
          : 'JSON Parse Hook 已安装，监控所有 JSON.parse 调用',
        tooltype: 'hook_json_parse',
        data: { hookId: 'hook_json_parse' },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `错误：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'hook_json_parse',
        data: { hookId: 'hook_json_parse' },
      });
    }
  },
});
