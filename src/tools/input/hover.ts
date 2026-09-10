/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 将鼠标悬停在指定元素上。
 */
export const hover = defineTool({
  name: 'hover',
  description:
    '将鼠标悬停在指定元素上。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '悬停元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      await page.locator(selector).hover();
      response.setStructuredContent({
        success: true,
        message: `Successfully hovered over element: ${selector}`,
        tooltype: 'hover',
        data: {selector},
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'hover', selector});
    }
  },
});
