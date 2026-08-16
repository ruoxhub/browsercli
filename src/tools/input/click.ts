/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const DEFAULT_CLICK_TIMEOUT_MS = 10_000;

/**
 * 点击页面元素，支持单击和双击。
 */
export const click = defineTool({
  name: 'click',
  description: '通过 CSS 选择器匹配元素并点击，支持单击与双击。',
  annotations: {
    title: '点击元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器。'),
    dblClick: zod.boolean().optional().describe('是否双击，默认 false。'),
    timeoutMs: browserTimeoutSchema('页面操作超时（毫秒，默认 10000）。'),
  },
  handler: async (request, response, context) => {
    const {
      selector,
      dblClick = false,
      timeoutMs = DEFAULT_CLICK_TIMEOUT_MS,
    } = request.params;

    if (!selector) {
      response.setStructuredContent({
        success: false,
        message: 'selector 参数不能为空',
        tooltype: 'click',
      });
      return;
    }

    const frame = (context as Context).getSelectedFrame();

    try {
      await withDebuggerTrapBypass(context, async () => {
        await withOperationTimeout(
          frame.click(selector, {
            clickCount: dblClick ? 2 : 1,
            timeout: timeoutMs,
          }),
          '点击页面元素',
          timeoutMs,
        );
      });
      response.setStructuredContent({
        success: true,
        message: `Successfully ${dblClick ? 'double ' : ''}clicked on element: ${selector}`,
        tooltype: 'click',
        data: {selector, dblClick},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        tooltype: 'click',
        data: {selector, dblClick},
      });
    }
  },
});
