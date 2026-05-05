/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

/**
 * 将元素从源选择器拖拽到目标选择器。
 */
export const drag = defineTool({
  name: 'drag',
  description:
    'Drag an element from a source CSS selector to a target CSS selector using mouse events.',
  annotations: {
    title: '拖拽元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    fromSelector: zod.string().describe('拖拽源 CSS 选择器。'),
    toSelector: zod.string().describe('拖拽目标 CSS 选择器。'),
  },
  handler: async (request, response, context) => {
    const {fromSelector, toSelector} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const fromElement = await page.$(fromSelector);
      const toElement = await page.$(toSelector);

      if (!fromElement) {
        response.appendResponseLine(
          `Source element not found: ${fromSelector}`,
        );
        return;
      }
      if (!toElement) {
        response.appendResponseLine(
          `Target element not found: ${toSelector}`,
        );
        return;
      }

      const fromBox = await fromElement.boundingBox();
      const toBox = await toElement.boundingBox();

      if (!fromBox || !toBox) {
        response.appendResponseLine('Element bounding box not available');
        return;
      }

      const fromX = fromBox.x + fromBox.width / 2;
      const fromY = fromBox.y + fromBox.height / 2;
      const toX = toBox.x + toBox.width / 2;
      const toY = toBox.y + toBox.height / 2;

      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(toX, toY);
      await page.mouse.up();

      response.appendResponseLine(
        `Successfully dragged element from ${fromSelector} to ${toSelector}`,
      );
    } catch (error) {
      response.appendResponseLine(
        `Drag failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
