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
 * 等待选择器对应的元素出现在页面中。
 */
export const waitForElement = defineTool({
  name: 'wait_for_element',
  description: '等待匹配 CSS 选择器的元素出现在页面中。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: true},
  schema: {
    selector: zod.string().describe('要等待的 CSS 选择器。'),
    timeout: zod
      .number()
      .optional()
      .describe('最长等待时间（毫秒，默认 30000）。'),
  },
  handler: async (request, response, context) => {
    const {selector, timeout} = request.params;

    try {
      const page = context.getSelectedPage();

      await page.waitForSelector(selector, {
        timeout: timeout ?? 30000,
      });

      const element = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: el.textContent?.trim().substring(0, 100) || undefined,
          attributes: Array.from(el.attributes).reduce(
            (acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            },
            {} as Record<string, string>,
          ),
        };
      }, selector);

      sendJson(response, {
        success: true,
        message: `元素已出现: ${selector}`,
        tooltype: 'wait_for_element',
        data: {selector, appeared: true, element},
      });
    } catch {
      sendJson(response, {
        success: false,
        message: `等待元素超时: ${selector}`,
        tooltype: 'wait_for_element',
        data: {selector, appeared: false, element: null},
      });
    }
  },
});
