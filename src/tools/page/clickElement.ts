/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

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
      sendJson(response, {
        success: true,
        message: `元素已点击: ${selector}`,
        tooltype: 'click_element',
        data: {selector, clicked: true},
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: `点击元素失败: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'click_element',
        data: {selector, clicked: false},
      });
    }
  },
});
