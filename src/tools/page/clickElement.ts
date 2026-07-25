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
  description: '通过 CSS 选择器点击页面元素。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  schema: {
    selector: zod.string().describe('要点击元素的 CSS 选择器。'),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    try {
      const page = context.getSelectedPage();
      if (!page) {
        sendJson(response, {
          success: false,
          message: '未选中页面，请先使用 select_page 选择目标页面。',
          tooltype: 'click_element',
        });
        return;
      }
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
