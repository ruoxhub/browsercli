/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import {zod} from '../../third_party/index.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 捕获视频当前帧（defineTool 版本）。
 *
 * 先 seek 到指定时间（可选），然后截取视频元素当前帧。
 * 参考 old-source 中 screenshot 的响应模式：
 *   - 小于 2MB 直接附加图片到响应
 *   - 指定 outputPath 时保存到指定路径
 */
export const captureVideoFrame = defineTool({
  name: 'capture_video_frame',
  description: `捕获视频元素的当前帧。可选地先定位到指定时间点。以图片形式返回该帧。`,
  annotations: {
    title: '捕获视频帧',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('视频元素的 CSS 选择器。'),
    seekTime: zod
      .number()
      .optional()
      .describe(
        '捕获前定位到的时间点（秒，可选）。',
      ),
    outputPath: zod
      .string()
      .optional()
      .describe('保存捕获帧的文件路径（可选）。'),
    format: zod
      .enum(['png', 'jpeg'])
      .default('png')
      .describe('捕获帧的图片格式。默认 "png"。'),
    quality: zod
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'JPEG 格式的压缩质量（0-100）。PNG 格式忽略此参数。',
      ),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;

    try {
      const page = await runtime.getActivePage();

      // 先定位到指定时间点
      if (request.params.seekTime !== undefined) {
        await page.evaluate(
          ({sel, t}) => {
            const video = document.querySelector(sel) as HTMLVideoElement;
            if (video) {
              video.currentTime = t;
            }
          },
          {sel: request.params.selector, t: request.params.seekTime},
        );
        // 等待 seek 完成
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // 获取视频帧的边界框
      const videoBox = await page.evaluate(sel => {
        const video = document.querySelector(sel) as HTMLVideoElement;
        if (!video) return null;
        const rect = video.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }, request.params.selector);

      if (!videoBox) {
        response.setStructuredContent({
          success: false,
          message: `视频元素未找到: ${request.params.selector}`,
          tooltype: 'capture_video_frame',
        });
        return;
      }

      const format = request.params.format;

      // 自动创建输出目录
      if (request.params.outputPath) {
        const dir = path.dirname(request.params.outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, {recursive: true});
        }
      }

      // 截图
      const buffer = await page.screenshot({
        path: request.params.outputPath,
        type: format,
        quality: request.params.quality,
        clip: {
          x: Math.round(videoBox.x),
          y: Math.round(videoBox.y),
          width: Math.round(videoBox.width),
          height: Math.round(videoBox.height),
        },
      });

      const frameBuffer = Buffer.from(buffer);

      let savedPath: string | null = null;
      let base64Image: string | null = null;

      if (request.params.outputPath) {
        savedPath = request.params.outputPath;
      } else if (frameBuffer.length >= 2_000_000) {
        // 大文件保存临时文件
        const {filename} = await context.saveTemporaryFile(
          frameBuffer as unknown as Uint8Array<ArrayBufferLike>,
          `image/${format}` as 'image/png' | 'image/jpeg',
        );
        savedPath = filename;
      } else {
        // 小文件直接附加图片到响应
        base64Image = frameBuffer.toString('base64');
      }

      response.setStructuredContent({
        success: true,
        message:
          request.params.seekTime !== undefined
            ? `Captured video frame at ${request.params.seekTime}s from ${request.params.selector}.`
            : `Captured video frame from ${request.params.selector}.`,
        tooltype: 'capture_video_frame',
        data: {
          selector: request.params.selector,
          seekTime: request.params.seekTime,
          format,
          clip: {
            x: Math.round(videoBox.x),
            y: Math.round(videoBox.y),
            width: Math.round(videoBox.width),
            height: Math.round(videoBox.height),
          },
          fileSize: frameBuffer.length,
          savedPath,
          base64: base64Image,
        },
      });

      if (base64Image) {
        response.attachImage({
          mimeType: `image/${format}`,
          data: base64Image,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      response.setStructuredContent({
        success: false,
        message: `捕获视频帧失败: ${errorMsg}`,
        tooltype: 'capture_video_frame',
        data: {},
      });
    }
  },
});
