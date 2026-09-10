/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 将元素从源选择器拖拽到目标选择器。
 */
export const drag = defineTool({
  name: 'drag',
  description:
    '通过鼠标事件将元素从源定位器拖拽到目标定位器。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '拖拽元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    fromSelector: zod
      .string()
      .describe(
        '拖拽源定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    toSelector: zod
      .string()
      .describe(
        '拖拽目标定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
  },
  handler: async (request, response, context) => {
    const {fromSelector, toSelector} = request.params;
    const frame = (context as Context).getSelectedFrame();
    const page = frame.page();

    try {
      const fromBox = await page.locator(fromSelector).boundingBox();
      if (!fromBox) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Source element bounding box not available: ${fromSelector}`,
          {toolName: 'drag', fromSelector},
        );
      }
      const toBox = await page.locator(toSelector).boundingBox();
      if (!toBox) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `Target element bounding box not available: ${toSelector}`,
          {toolName: 'drag', toSelector},
        );
      }

      const fromX = fromBox.x + fromBox.width / 2;
      const fromY = fromBox.y + fromBox.height / 2;
      const toX = toBox.x + toBox.width / 2;
      const toY = toBox.y + toBox.height / 2;

      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(toX, toY);
      await page.mouse.up();

      response.setStructuredContent({
        success: true,
        message: `Successfully dragged element from ${fromSelector} to ${toSelector}`,
        tooltype: 'drag',
        data: {
          fromSelector,
          toSelector,
          from: {x: fromX, y: fromY},
          to: {x: toX, y: toY},
        },
      });
    } catch (error) {
      throw toElementError(error, {
        toolName: 'drag',
        selector: fromSelector,
        fromSelector,
        toSelector,
      });
    }
  },
});
