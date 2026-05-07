/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 点击页面元素，支持单击和双击。
 */
export const click = defineTool({
  name: 'click',
  description:
    'Click on an element matched by CSS selector. Supports single and double click.',
  annotations: {
    title: '点击元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器。'),
    dblClick: zod
      .boolean()
      .optional()
      .describe('是否双击，默认 false。'),
  },
  handler: async (request, response, context) => {
    const {selector, dblClick = false} = request.params;

    if (!selector) {
      response.setStructuredContent({
        success: false,
        message: 'selector 参数不能为空',
        tooltype: 'click',
      });
      return;
    }

    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      await page.click(selector, {clickCount: dblClick ? 2 : 1});
      response.setStructuredContent({
        success: true,
        message: `Successfully ${dblClick ? 'double ' : ''}clicked on element: ${selector}`,
        tooltype: 'click',
        data: {selector, dblClick},
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        tooltype: 'click',
        data: {selector, dblClick},
      });
    }
  },
});
