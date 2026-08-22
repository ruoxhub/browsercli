/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 将鼠标悬停在指定元素上。
 */
export const hover = defineTool({
  name: 'hover',
  description: '将鼠标悬停在匹配 CSS 选择器的元素上。',
  annotations: {
    title: '悬停元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS 选择器。'),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const element = await page.$(selector);
      if (!element) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Element not found: ${selector}`,
          {toolName: 'hover', selector},
        );
      }

      await element.hover();
      response.setStructuredContent({
        success: true,
        message: `Successfully hovered over element: ${selector}`,
        tooltype: 'hover',
        data: {selector},
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        error instanceof Error ? error.message : String(error),
        {toolName: 'hover', selector},
      );
    }
  },
});
