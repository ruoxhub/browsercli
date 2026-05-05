/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

/**
 * 获取视频元素信息（defineTool 版本）。
 *
 * 通过 CSS 选择器定位视频元素，返回 duration、currentTime、paused、src。
 */
export const getVideoInfo = defineTool({
  name: 'get_video_info',
  description: `Get video element information by CSS selector. Returns duration, currentTime, paused state, and src.`,
  annotations: {
    title: '获取视频信息',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS selector for the video element.'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;

    try {
      const page = await runtime.getActivePage();
      const info = await page.evaluate(sel => {
        const video = document.querySelector(sel) as HTMLVideoElement;
        if (!video) return null;
        return {
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused,
          src: video.src,
        };
      }, request.params.selector);

      if (!info) {
        response.appendResponseLine(
          `视频元素未找到: ${request.params.selector}`,
        );
        return;
      }

      response.appendResponseLine(
        `视频信息获取成功: ${request.params.selector}`,
      );
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `视频信息获取成功: ${request.params.selector}`,
            tooltype: 'get_video_info',
            logFormat: 'json',
            data: {
              selector: request.params.selector,
              ...info,
            },
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      response.appendResponseLine(`获取视频信息失败: ${errorMsg}`);
    }
  },
});
