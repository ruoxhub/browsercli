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
 * 在输入元素中键入文本。
 */
export const typeText = defineTool({
  name: 'type_text',
  description:
    '向输入框键入文本。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: false},
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    text: zod.string().describe('要输入的文本。'),
    delay: zod.number().optional().describe('每次按键之间的延迟（毫秒）。'),
  },
  handler: async (request, response, context) => {
    const {selector, text, delay} = request.params;

    if (!selector || !text) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'type_text requires "selector" and "text" parameters',
        {toolName: 'type_text'},
      );
    }

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'type_text'},
      );
    }

    try {
      await page.locator(selector).pressSequentially(text, {delay});
      sendJson(response, {
        success: true,
        message: `文本已输入: ${selector}`,
        tooltype: 'type_text',
        data: {selector, textLength: text.length, typed: true},
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'type_text',
        selector,
        textLength: text.length,
      });
    }
  },
});
