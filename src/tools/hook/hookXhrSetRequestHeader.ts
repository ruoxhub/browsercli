/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context, type Response} from '../ToolDefinition.js';

export const hookXhrSetRequestHeader = defineTool({
  name: 'hook_xhr_set_request_header',
  description:
    'Hook XMLHttpRequest.setRequestHeader：监控请求头设置，支持过滤特定 Header 名',
  annotations: {
    title: 'Hook XHR Set Request Header',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: false,
  },
  schema: {
    filterKeys: zod
      .array(zod.string())
      .optional()
      .describe('要监控的特定 Header 名称'),
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
      const frame = context.getSelectedFrame();
      await frame.evaluate(hookCode);
      response.appendResponseLine('✅ XHR SetRequestHeader Hook 已安装');
      response.appendResponseLine(
        hasFilter
          ? `- 过滤 Header：${filterKeys!.join(', ')}`
          : '- 监控所有请求头设置',
      );
    } catch (error) {
      response.appendResponseLine(
        `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
