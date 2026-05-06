/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 调整页面窗口尺寸。
 */
export const resizePage = defineTool({
  name: 'resize_page',
  description: 'Resize page viewport to specified width and height',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    width: zod.number().describe('Viewport width in pixels'),
    height: zod.number().describe('Viewport height in pixels'),
  },
  handler: async (request, response, context) => {
    const {width, height} = request.params;
    const tooltype = 'resize_page';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      await page.setViewportSize({width, height});
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `页面尺寸已调整为 ${width}x${height}`,
            tooltype,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `页面尺寸调整失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
