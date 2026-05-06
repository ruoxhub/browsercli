/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {defineTool, type Context} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

/**
 * 按方向滚动页面。
 */
export const scrollBy = defineTool({
  name: 'scroll_by',
  description: 'Scroll page by direction (up/down/top/bottom), automatically waits 800ms for lazy-loaded content',
  annotations: {category: ToolCategory.INPUT, readOnlyHint: true},
  schema: {
    direction: zod
      .enum(['up', 'down', 'top', 'bottom'])
      .describe('Scroll direction'),
    pixels: zod
      .number()
      .optional()
      .describe('Pixels to scroll (only for up/down, default 1000)'),
  },
  handler: async (request, response, context) => {
    const {direction, pixels = 1000} = request.params;

    try {
      const page = context.getSelectedPage();

      const result = await page.evaluate(
        (dir: string, px: number) => {
          switch (dir) {
            case 'top':
              window.scrollTo(0, 0);
              return 'scrolled to top';
            case 'bottom':
              window.scrollTo(0, document.body.scrollHeight);
              return 'scrolled to bottom';
            case 'up':
              window.scrollBy(0, -Math.abs(px));
              return `scrolled up ${Math.abs(px)}px`;
            case 'down':
              window.scrollBy(0, Math.abs(px));
              return `scrolled down ${Math.abs(px)}px`;
            default:
              return 'unknown direction';
          }
        },
        direction,
        pixels,
      );

      // 等待懒加载触发
      await new Promise(resolve => setTimeout(resolve, 800));

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `页面已滚动: ${direction}`,
            tooltype: 'scroll_by',
            data: {direction, pixels, result},
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
            message: `滚动页面失败: ${error instanceof Error ? error.message : String(error)}`,
            tooltype: 'scroll_by',
            data: {direction, pixels, result: ''},
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
