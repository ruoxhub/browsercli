/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

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
  description: `对页面或元素进行截图。`,
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
      .describe('截图保存的格式类型。默认 "png"'),
    quality: zod
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'JPEG 与 WebP 格式的压缩质量（0-100）。值越大质量越好但文件越大。PNG 格式忽略此参数。',
      ),
    fullPage: zod
      .boolean()
      .optional()
      .describe(
        '若为 true，截取整个页面而非当前可见视口。',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        '截图保存的绝对路径，或相对于当前工作目录的路径；指定后截图将保存到该路径而非附加到响应。',
      ),
  },
  handler: async (request, response, context) => {
    const format = request.params.format;
    const quality = format === 'png' ? undefined : request.params.quality;

    try {
      const page = context.getSelectedPage();
      if (!page) {
        response.setStructuredContent({
          success: false,
          message: '未选中页面，请先使用 select_page 选择目标页面。',
          tooltype: 'take_screenshot',
        });
        return;
      }

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
