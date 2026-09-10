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
 * 点击页面元素。
 */
export const clickElement = defineTool({
  name: 'click_element',
  description:
    '点击页面元素。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'click_element'},
      );
    }
    try {
      await page.locator(selector).click();
      sendJson(response, {
        success: true,
        message: `元素已点击: ${selector}`,
        tooltype: 'click_element',
        data: {selector, clicked: true},
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'click_element', selector});
    }
  },
});
