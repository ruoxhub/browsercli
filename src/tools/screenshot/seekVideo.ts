/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 定位视频到指定时间点（defineTool 版本）。
 *
 * 通过 CSS 选择器定位视频元素，设置 currentTime。
 */
export const seekVideo = defineTool({
  name: 'seek_video',
  description: `Seek a video element to a specific time position by CSS selector.`,
  annotations: {
    title: '跳转视频',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector for the video element.'),
    time: zod
      .number()
      .describe('Time position in seconds to seek to.'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;

    try {
      const page = await runtime.getActivePage();
      await page.evaluate(
        ({sel, t}) => {
          const video = document.querySelector(sel) as HTMLVideoElement;
          if (video) {
            video.currentTime = t;
          }
        },
        {sel: request.params.selector, t: request.params.time},
      );

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
      const errorMsg = error instanceof Error ? error.message : String(error);
      response.setStructuredContent({
        success: false,
        message: `视频定位失败: ${errorMsg}`,
        tooltype: 'seek_video',
        data: {},
      });
    }
  },
});
