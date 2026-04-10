/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookJsonParse = defineTool({
  name: 'hook_json_parse',
  description: 'Hook JSON.parse：监控 JSON 解析操作，支持过滤特定字符串',
  annotations: {
    title: 'Hook JSON Parse',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要过滤的特定 JSON 字符串内容'),
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
    const {filterKeys, showStack, triggerDebugger} = request.params;
    const hasFilter = filterKeys && filterKeys.length > 0;

    const hookCode = `
(function() {
  'use strict';
  const filterKeys = ${JSON.stringify(filterKeys || [])};
  const showStack = ${JSON.stringify(!!showStack)};
  const triggerDebugger = ${JSON.stringify(!!triggerDebugger)};
  const hasFilter = filterKeys.length > 0;
  const origParse = JSON.parse;

  JSON.parse = function() {
    if (!hasFilter) {
      console.log('调用JSON.parse ---> ', arguments[0]);
    } else if (arguments[0] && typeof arguments[0] === 'string' && filterKeys.some(item => arguments[0].includes(item))) {
      console.log('捕获到JSON.parse指定字符串 ---> ', arguments[0]);
    } else {
      return origParse.apply(this, arguments);
    }
    if (triggerDebugger) debugger;
    if (showStack) console.log(new Error().stack);
    return origParse.apply(this, arguments);
  };
  console.log('[hook_json_parse] ✅ JSON.parse hook installed');
})();
`;

    try {
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ JSON Parse Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤字符串：${filterKeys!.join(', ')}`
          : '- 监控所有 JSON.parse 调用',
      );
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
