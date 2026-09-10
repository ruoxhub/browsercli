/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 等待选择器对应的元素出现在页面中。
 */
export const waitForElement = defineTool({
  name: 'wait_for_element',
  description:
    '等待定位器对应的元素出现在页面中。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: true},
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    timeout: zod
      .number()
      .optional()
      .describe('最长等待时间（毫秒，默认 30000）。'),
  },
  handler: async (request, response, context) => {
    const {selector, timeout} = request.params;

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'wait_for_element'},
      );
    }

    try {
      await page.locator(selector).waitFor({
        state: 'visible',
        timeout: timeout ?? 30000,
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'wait_for_element',
        selector,
        timeout: timeout ?? 30000,
      });
    }

    const element = await page
      .locator(selector)
      .first()
      .evaluate((el: Element) => {
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
      })
      .catch(() => null);

    sendJson(response, {
      success: true,
      message: `元素已出现: ${selector}`,
      tooltype: 'wait_for_element',
      data: {selector, appeared: true, element},
    });
  },
});
