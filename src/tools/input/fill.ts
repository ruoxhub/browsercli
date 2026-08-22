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
} from '../shared/browserRuntime.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import {fillElement} from './fillElement.js';

/**
 * 在 input/textarea/select 元素中填入值。
 */
export const fill = defineTool({
  name: 'fill',
  description:
    '向匹配 CSS 选择器的 input、textarea 或 select 元素填入值，<select> 会通过 selectOption 自动处理。',
  annotations: {
    title: '填充输入',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS 选择器（input / textarea / select）。'),
    value: zod.string().describe('填充值。'),
    timeoutMs: browserTimeoutSchema('单次页面操作超时（毫秒，默认 10000）。'),
  },
  handler: async (request, response, context) => {
    const {selector, timeoutMs, value} = request.params;
    const frame = (context as Context).getSelectedFrame();

    try {
      const {found, isSelect} = await withDebuggerTrapBypass(
        context,
        async () => await fillElement(frame, selector, value, timeoutMs),
      );
      if (!found) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Element not found: ${selector}`,
          {toolName: 'fill', selector},
        );
      }

      response.setStructuredContent({
        success: true,
        message: `Successfully filled value into element: ${selector}`,
        tooltype: 'fill',
        data: {selector, value, isSelect},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'fill', selector, value},
      );
    }
  },
});
