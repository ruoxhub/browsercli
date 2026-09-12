/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 调整页面窗口尺寸。
 */
export const resizePage = defineTool({
  name: 'resize_page',
  description: '将页面视口调整为指定的宽度与高度。',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    width: zod
      .number()
      .int()
      .min(1)
      .max(10000)
      .describe('视口宽度（像素），1-10000 的整数。'),
    height: zod
      .number()
      .int()
      .min(1)
      .max(10000)
      .describe('视口高度（像素），1-10000 的整数。'),
  },
  handler: async (request, response, context) => {
    const {width, height} = request.params;
    const tooltype = 'resize_page';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      await page.setViewportSize({width, height});
      response.setStructuredContent({
        success: true,
        message: `页面尺寸已调整为 ${width}x${height}`,
        tooltype,
        data: {width, height},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `页面尺寸调整失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'resize_page', width, height},
      );
    }
  },
});
