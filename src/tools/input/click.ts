/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {
  browserTimeoutSchema,
  withDebuggerTrapBypass,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const DEFAULT_CLICK_TIMEOUT_MS = 10_000;

/**
 * 点击页面元素，支持单击和双击。
 */
export const click = defineTool({
  name: 'click',
  description:
    '点击页面元素，支持单击与双击。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '点击元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
    requirements: {
      browser: 'connected',
      page: 'selected',
      frame: 'selected',
      debugger: 'running',
    },
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
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
      throw createToolError(ErrorCodes.VALIDATION, 'selector 参数不能为空', {
        toolName: 'click',
      });
    }

    const frame = (context as Context).getSelectedFrame();

    try {
      await withDebuggerTrapBypass(context, async () => {
        await withOperationTimeout(
          frame.locator(selector).click({
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
      throw toElementError(error, {toolName: 'click', selector, dblClick});
    }
  },
});
