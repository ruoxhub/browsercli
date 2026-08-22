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
 * 批量填充表单元素。
 */
export const fillForm = defineTool({
  name: 'fill_form',
  description:
    '在一次调用中批量填充多个表单元素，每个条目指定 CSS 选择器与值，<select> 通过 selectOption 自动处理。',
  annotations: {
    title: '批量填充表单',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    elements: zod
      .array(
        zod.object({
          selector: zod.string().describe('CSS 选择器。'),
          value: zod.string().describe('填充值。'),
        }),
      )
      .describe('要填充的元素列表。'),
    timeoutMs: browserTimeoutSchema(
      '每个元素的单次页面操作超时（毫秒，默认 10000）。',
    ),
  },
  handler: async (request, response, context) => {
    const {elements, timeoutMs} = request.params;
    const frame = (context as Context).getSelectedFrame();

    if (!Array.isArray(elements) || elements.length === 0) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'fill_form requires a non-empty "elements" array',
        {toolName: 'fill_form'},
      );
    }

    const total = elements.length;
    let filled = 0;

    try {
      await withDebuggerTrapBypass(context, async () => {
        for (const element of elements) {
          const result = await fillElement(
            frame,
            element.selector,
            element.value,
            timeoutMs,
          );
          if (result.found) filled += 1;
        }
      });

      response.setStructuredContent({
        success: true,
        message: `Successfully filled out ${filled}/${total} form elements`,
        tooltype: 'fill_form',
        data: {filled, total, elements},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'fill_form', filled, total},
      );
    }
  },
});
