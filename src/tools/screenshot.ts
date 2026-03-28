/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {defineTool} from './ToolDefinition.js';

export const screenshot = defineTool({
  name: 'take_screenshot',
  description: `Take a screenshot of the page or element.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    // Not read-only due to filePath param.
    readOnlyHint: false,
  },
  schema: {
    format: zod
      .enum(['png', 'jpeg', 'webp'])
      .default('png')
      .describe('Type of format to save the screenshot as. Default is "png"'),
    quality: zod
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'Compression quality for JPEG and WebP formats (0-100). Higher values mean better quality but larger file sizes. Ignored for PNG format.',
      ),
    fullPage: zod
      .boolean()
      .optional()
      .describe(
        'If set to true takes a screenshot of the full page instead of the currently visible viewport. Incompatible with uid.',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute path, or a path relative to the current working directory, to save the screenshot to instead of attaching it to the response.',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();

    const format = request.params.format;
    const quality = format === 'png' ? undefined : request.params.quality;

    const screenshot = await page.screenshot({
      type: format,
      fullPage: request.params.fullPage,
      quality,
      optimizeForSpeed: true, // Bonus: optimize encoding for speed
    });

    if (request.params.fullPage) {
      response.appendResponseLine(
        'Took a screenshot of the full current page.',
      );
    } else {
      response.appendResponseLine(
        "Took a screenshot of the current page's viewport.",
      );
    }

    if (request.params.filePath) {
      const file = await context.saveFile(screenshot, request.params.filePath);
      response.appendResponseLine(`Saved screenshot to ${file.filename}.`);
    } else if (screenshot.length >= 2_000_000) {
      const {filename} = await context.saveTemporaryFile(
        screenshot,
        `image/${request.params.format}`,
      );
      response.appendResponseLine(`Saved screenshot to ${filename}.`);
    } else {
      response.attachImage({
        mimeType: `image/${request.params.format}`,
        data: Buffer.from(screenshot).toString('base64'),
      });
    }
  },
});

/**
 * 🆕 获取视频元素信息
 */
export const getVideoInfo = defineTool({
  name: 'get_video_info',
  description: 'Get HTMLVideoElement info including duration, currentTime, paused state, and src.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the video element'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const info = await runtime.pageController.getVideoInfo(request.params.selector);

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(info, null, 2));
    response.appendResponseLine('```');
  },
});

/**
 * 🆕 定位视频到指定时间点
 */
export const seekVideo = defineTool({
  name: 'seek_video',
  description: 'Seek video element to specified time (in seconds).',
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the video element'),
    time: zod.number().nonnegative().describe('Time in seconds to seek to'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    await runtime.pageController.seekVideo(request.params.selector, request.params.time);
    response.appendResponseLine(`Video seeked to ${request.params.time}s`);
  },
});

/**
 * 🆕 捕获视频当前帧
 */
export const captureVideoFrame = defineTool({
  name: 'capture_video_frame',
  description: 'Capture a specific frame from a video element. Can seek to a specific time before capturing.',
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    selector: zod.string().describe('CSS selector of the video element'),
    seekTime: zod.number().nonnegative().optional().describe('Time in seconds to seek before capturing'),
    outputPath: zod.string().optional().describe('Output file path (optional, returns buffer if not specified)'),
    format: zod.enum(['png', 'jpeg']).optional().default('png'),
    quality: zod.number().min(0).max(100).optional().describe('Image quality for JPEG (0-100)'),
  },
  handler: async (request, response, context) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.pageController.captureVideoFrame(
      request.params.selector,
      {
        seekTime: request.params.seekTime,
        outputPath: request.params.outputPath,
        format: request.params.format,
        quality: request.params.quality,
      }
    );

    if (typeof result === 'string') {
      response.appendResponseLine(`Video frame captured: ${result}`);
    } else {
      // Save to temporary file if no outputPath provided
      const {filename} = await context.saveTemporaryFile(result, 'image/png');
      response.appendResponseLine(`Video frame captured: ${filename}`);
    }
  },
});
