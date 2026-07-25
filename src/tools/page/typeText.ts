/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {errorMessage, sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 在输入元素中键入文本。
 */
export const typeText = defineTool({
  name: 'type_text',
  description: '通过 CSS 选择器向输入框键入文本。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  schema: {
    selector: zod.string().describe('输入元素的 CSS 选择器。'),
    text: zod.string().describe('要输入的文本。'),
    delay: zod.number().optional().describe('每次按键之间的延迟（毫秒）。'),
  },
  handler: async (request, response, context) => {
    const {selector, text, delay} = request.params;

    if (!selector || !text) {
      sendJson(response, {
        success: false,
        message: 'type_text requires "selector" and "text" parameters',
        tooltype: 'type_text',
        data: {selector: selector ?? '', textLength: 0, typed: false},
      });
      return;
    }

    try {
      const page = context.getSelectedPage();
      if (!page) {
        sendJson(response, {
          success: false,
          message: '未选中页面，请先使用 select_page 选择目标页面。',
          tooltype: 'type_text',
        });
        return;
      }
      await page.type(selector, text, {delay});
      sendJson(response, {
        success: true,
        message: `文本已输入: ${selector}`,
        tooltype: 'type_text',
        data: {selector, textLength: text.length, typed: true},
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: `输入文本失败: ${errorMessage(error)}`,
        tooltype: 'type_text',
        data: {selector, textLength: text.length, typed: false},
      });
    }
  },
});
