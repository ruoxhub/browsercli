/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 定位视频到指定时间点（defineTool 版本）。
 *
 * 通过定位器定位视频元素，设置 currentTime。
 */
export const seekVideo = defineTool({
  name: 'seek_video',
  description:
    '按定位器将视频元素定位到指定时间点。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '跳转视频',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
    time: zod.number().describe('要定位到的时间点（秒）。'),
  },
  handler: async (request, response, context) => {
    const selector = request.params.selector;
    const time = request.params.time;
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'seek_video'},
      );
    }
    try {
      const loc = page.locator(selector);
      const count = await loc.count();
      if (count === 0) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `未找到匹配的视频元素: ${selector}`,
          {toolName: 'seek_video', selector, time},
        );
      }

      await loc.first().evaluate((el: Element, t: number) => {
        const video = el as HTMLVideoElement;
        video.currentTime = t;
      }, time);

      response.setStructuredContent({
        success: true,
        message: `视频已定位到 ${time}s: ${selector}`,
        tooltype: 'seek_video',
        data: {
          selector,
          time,
        },
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'seek_video', selector, time});
    }
  },
});
