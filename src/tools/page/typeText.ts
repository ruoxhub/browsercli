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
  description: 'Type text into an input element by CSS selector',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  schema: {
    selector: zod.string().describe('CSS selector of the input element'),
    text: zod.string().describe('Text to type'),
    delay: zod.number().optional().describe('Delay between keystrokes in ms'),
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
