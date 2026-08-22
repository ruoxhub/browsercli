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
 * 定位视频到指定时间点（defineTool 版本）。
 *
 * 通过 CSS 选择器定位视频元素，设置 currentTime。
 */
export const seekVideo = defineTool({
  name: 'seek_video',
  description: `按 CSS 选择器将视频元素定位到指定时间点。`,
  annotations: {
    title: '跳转视频',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('视频元素的 CSS 选择器。'),
    time: zod.number().describe('要定位到的时间点（秒）。'),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'seek_video'},
      );
    }
    try {
      const found = await page.evaluate(
        ({sel, t}) => {
          const video = document.querySelector(sel) as HTMLVideoElement | null;
          if (video) {
            video.currentTime = t;
            return true;
          }
          return false;
        },
        {sel: request.params.selector, t: request.params.time},
      );

      if (!found) {
        throw createToolError(
          ErrorCodes.NOT_FOUND,
          `未找到匹配的视频元素: ${request.params.selector}`,
          {toolName: 'seek_video', selector: request.params.selector, time: request.params.time},
        );
      }

      response.setStructuredContent({
        success: true,
        message: `视频已定位到 ${request.params.time}s: ${request.params.selector}`,
        tooltype: 'seek_video',
        data: {
          selector: request.params.selector,
          time: request.params.time,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw createToolError(
        ErrorCodes.RUNTIME,
        `视频定位失败: ${errorMsg}`,
        {toolName: 'seek_video'},
      );
    }
  },
});
