/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 批量填充表单元素。
 */
export const fillForm = defineTool({
  name: 'fill_form',
  description:
    'Fill multiple form elements in one call. Each entry specifies a CSS selector and a value. Automatically handles <select> via selectOption.',
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
  },
  handler: async (request, response, context) => {
    const elements = request.params.elements;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    if (!Array.isArray(elements) || elements.length === 0) {
      response.appendResponseLine(
        'fill_form requires a non-empty "elements" array',
      );
      return;
    }

    const total = elements.length;
    let filled = 0;

    try {
      for (const element of elements) {
        const el = await page.$(element.selector);
        if (el) {
          const isSelect = await page.evaluate(sel => {
            const ele = document.querySelector(sel);
            return ele?.tagName === 'SELECT';
          }, element.selector);

          if (isSelect) {
            await el.selectOption(element.value);
          } else {
            await el.fill(element.value);
          }
          filled += 1;
        }
      }

      const result = {
        success: true,
        message: `Successfully filled out ${filled}/${total} form elements`,
        tooltype: 'fill_form',
        logFormat: 'simple',
        data: {filled, total},
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    } catch (error) {
      const result = {
        success: false,
        message: `FillForm failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'fill_form',
        data: {filled, total},
      };
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
    }
  },
});
