/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 点击页面元素。
 */
export const clickElement = defineTool({
  name: 'click_element',
  description: 'Click on an element by CSS selector',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  schema: {
    selector: zod.string().describe('CSS selector of the element to click'),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    try {
      const page = context.getSelectedPage();
      await page.click(selector);

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `元素已点击: ${selector}`,
            tooltype: 'click_element',
            data: {selector, clicked: true},
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `点击元素失败: ${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'click_element',
            data: {selector, clicked: false},
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
