/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {
  getActivePageWithGuard,
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

/**
 * 截图页面（defineTool 版本）。
 *
 * 截取当前页面视口或全页截图，支持保存到文件或返回 base64。
 * 参考 old-source 中的 handler 模式：
 *   - 小于 2MB 直接附加图片到响应
 *   - 大于 2MB 保存临时文件
 *   - 指定 filePath 时保存到指定路径
 */
export const takeScreenshot = defineTool({
  name: 'take_screenshot',
  description: `Take a screenshot of the page or element.`,
  annotations: {
    title: '截图',
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
        'If set to true takes a screenshot of the full page instead of the currently visible viewport.',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute path, or a path relative to the current working directory, to save the screenshot to instead of attaching it to the response.',
      ),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;
    const format = request.params.format;
    const quality = format === 'png' ? undefined : request.params.quality;

    try {
      const page = await getActivePageWithGuard(runtime);

      // 自动创建截图目录
      const resolvedFilePath = request.params.filePath
        ? path.resolve(request.params.filePath)
        : undefined;
      if (resolvedFilePath) {
        const dir = path.dirname(resolvedFilePath);
        fs.mkdirSync(dir, {recursive: true});
      }

      const screenshot = await withOperationTimeout(
        page.screenshot({
          type: format as 'png' | 'jpeg',
          fullPage: request.params.fullPage,
          quality,
          path: resolvedFilePath,
        }),
        '执行截图',
      );

      const screenshotBuffer = Buffer.isBuffer(screenshot)
        ? screenshot
        : Buffer.from(screenshot);

      let savedPath: string | null = null;
      let base64Image: string | null = null;

      if (resolvedFilePath) {
        savedPath = resolvedFilePath;
      } else if (screenshotBuffer.length >= 2_000_000) {
        // 大文件保存临时文件
        const {filename} = await context.saveTemporaryFile(
          screenshotBuffer as unknown as Uint8Array<ArrayBufferLike>,
          `image/${format}` as 'image/png' | 'image/jpeg' | 'image/webp',
        );
        savedPath = filename;
      } else {
        // 小文件直接附加图片到响应
        base64Image = screenshotBuffer.toString('base64');
      }

      response.setStructuredContent({
        success: true,
        message: request.params.fullPage
          ? 'Took a screenshot of the full current page.'
          : "Took a screenshot of the current page's viewport.",
        tooltype: 'screenshot',
        data: {
          format,
          fileSize: screenshotBuffer.length,
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
      response.setStructuredContent({
        success: false,
        message: `截图失败: ${normalizeBrowserRuntimeError(error)}`,
        tooltype: 'screenshot',
        data: {},
      });
    }
  },
});
