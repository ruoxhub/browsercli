/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 在 input/textarea/select 元素中填入值。
 */
export const fill = defineTool({
  name: 'fill',
  description:
    'Fill a value into an input, textarea, or select element matched by CSS selector. Automatically handles <select> via selectOption.',
  annotations: {
    title: '填充输入',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器（input / textarea / select）。'),
    value: zod.string().describe('填充值。'),
  },
  handler: async (request, response, context) => {
    const {selector, value} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const element = await page.$(selector);
      if (!element) {
        response.setStructuredContent({
          success: false,
          message: `Element not found: ${selector}`,
          tooltype: 'fill',
        });
        return;
      }

      const isSelect = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        return el?.tagName === 'SELECT';
      }, selector);

      if (isSelect) {
        await element.selectOption(value);
      } else {
        await element.fill(value);
      }

      response.setStructuredContent({
        success: true,
        message: `Successfully filled value into element: ${selector}`,
        tooltype: 'fill',
        data: {selector, value, isSelect},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        tooltype: 'fill',
        data: {selector, value},
      });
    }
  },
});
