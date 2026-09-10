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
 * 获取视频元素信息（defineTool 版本）。
 *
 * 通过定位器定位视频元素，返回 duration、currentTime、paused、src。
 */
export const getVideoInfo = defineTool({
  name: 'get_video_info',
  description:
    '按定位器获取视频元素信息。返回 duration、currentTime、暂停状态和 src。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '获取视频信息',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
  },
  handler: async (request, response, context) => {
    const selector = request.params.selector;
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'get_video_info'},
      );
    }
    try {
      const loc = page.locator(selector);
      const count = await loc.count();
      if (count === 0) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `视频元素未找到: ${selector}`,
          {toolName: 'get_video_info', selector},
        );
      }

      const info = await loc.first().evaluate((el: Element) => {
        const video = el as HTMLVideoElement;
        return {
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused,
          src: video.src,
        };
      });

      response.setStructuredContent({
        success: true,
        message: `视频信息获取成功: ${selector}`,
        tooltype: 'get_video_info',
        data: {
          selector,
          ...info,
        },
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'get_video_info', selector});
    }
  },
});
