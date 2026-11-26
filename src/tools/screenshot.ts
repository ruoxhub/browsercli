/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import {preparePageForLongScreenshot} from '../modules/screenshot/LongScreenshotEngine.js';
import {zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {
  browserTimeoutSchema,
  normalizeBrowserRuntimeError,
  withDebuggerTrapBypass,
  withOperationTimeout,
} from './shared/browserRuntime.js';
import {resolveTargetLocator} from './shared/elementLocator.js';
import {definePageTool} from './ToolDefinition.js';

// ─── takeScreenshot.ts ───────────────────────────────────

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 15_000;

const MAX_CHROMIUM_SCREENSHOT_DIMENSION = 16_384;

function readPngDimensions(
  buffer: Buffer,
): {width: number; height: number} | undefined {
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  return undefined;
}

/**
 * 截图页面或元素（definePageTool 版本）。
 *
 * 截取当前页面视口、全页或指定元素截图，支持保存到文件或返回 base64。
 */
export const takeScreenshot = definePageTool({
  name: 'take_screenshot',
  description: `对页面或指定元素（uid / selector）进行截图，支持全页与导出文件。`,
  annotations: {
    title: '截图',
    category: ToolCategory.DEBUGGING,
    // Not read-only due to filePath param.
    readOnlyHint: false,
  },
  blockedByDialog: true,
  concurrency: 'page',
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
    uid: zod
      .string()
      .optional()
      .describe(
        '要单独截取的页面元素 uid（来自 take_snapshot）。与 fullPage 互斥。',
      ),
    selector: zod
      .string()
      .optional()
      .describe('要单独截取的元素定位器（可选，与 fullPage 互斥）。'),
    fullPage: zod
      .boolean()
      .optional()
      .describe('若为 true，截取整个页面而非当前可见视口。'),
    filePath: zod
      .string()
      .optional()
      .describe(
        '截图保存的绝对路径，或相对于当前工作目录的路径；指定后截图将保存到该路径而非附加到响应。',
      ),
    timeoutMs: browserTimeoutSchema('截图超时（毫秒，默认 15000）。'),
  },
  handler: async (request, response, context) => {
    const format = request.params.format;
    const quality = format === 'png' ? undefined : request.params.quality;
    const timeoutMs = request.params.timeoutMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS;
    const {uid, selector, fullPage} = request.params;

    if ((uid || selector) && fullPage) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        'fullPage cannot be used together with uid or selector element screenshots.',
        {toolName: 'take_screenshot', uid, selector},
      );
    }

    const page = context.getSelectedPage();
    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '未选中页面，请先使用 select_page 选择目标页面。',
        {toolName: 'take_screenshot'},
      );
    }

    try {
      // 自动创建截图目录
      const resolvedFilePath = request.params.filePath
        ? path.resolve(request.params.filePath)
        : undefined;
      if (resolvedFilePath) {
        const dir = path.dirname(resolvedFilePath);
        fs.mkdirSync(dir, {recursive: true});
      }

      let cleanupSticky: (() => Promise<void>) | undefined;
      if (fullPage) {
        const prep = await preparePageForLongScreenshot(page);
        cleanupSticky = prep.restore;
      }

      const target =
        uid || selector
          ? resolveTargetLocator(context, {
              uid,
              selector,
              toolName: 'take_screenshot',
            })
          : undefined;

      let screenshot: Buffer | Uint8Array;
      try {
        screenshot = await withDebuggerTrapBypass(
          context,
          async () =>
            await withOperationTimeout(
              target
                ? target.locator.screenshot({
                    type: format as 'png' | 'jpeg',
                    quality,
                    path: resolvedFilePath,
                    timeout: timeoutMs,
                  })
                : page.screenshot({
                    type: format as 'png' | 'jpeg',
                    fullPage,
                    quality,
                    path: resolvedFilePath,
                    timeout: timeoutMs,
                  }),
              '执行截图',
              timeoutMs,
            ),
        );
      } finally {
        if (cleanupSticky) {
          await cleanupSticky();
        }
      }

      const screenshotBuffer = Buffer.isBuffer(screenshot)
        ? screenshot
        : Buffer.from(screenshot);
      const dimensions = readPngDimensions(screenshotBuffer);
      const truncatedWarning =
        dimensions &&
        (dimensions.width >= MAX_CHROMIUM_SCREENSHOT_DIMENSION ||
          dimensions.height >= MAX_CHROMIUM_SCREENSHOT_DIMENSION)
          ? `截图尺寸 (${dimensions.width}x${dimensions.height}) 已达到 Chromium 截图上限 (${MAX_CHROMIUM_SCREENSHOT_DIMENSION}px)，画面可能被裁剪。`
          : undefined;

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

      if (truncatedWarning) {
        response.appendResponseLine(`警告：${truncatedWarning}`);
      }

      response.setStructuredContent({
        success: true,
        message: target
          ? `Took a screenshot of element: ${target.targetDescription}.`
          : fullPage
            ? 'Took a screenshot of the full current page.'
            : "Took a screenshot of the current page's viewport.",
        tooltype: 'screenshot',
        data: {
          format,
          fileSize: screenshotBuffer.length,
          savedPath,
          base64: base64Image,
          ...(uid !== undefined ? {uid} : {}),
          ...(selector !== undefined ? {selector} : {}),
          ...(truncatedWarning ? {warning: truncatedWarning} : {}),
        },
      });

      if (base64Image) {
        response.attachImage({
          mimeType: `image/${format}`,
          data: base64Image,
        });
      }
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `截图失败: ${normalizeBrowserRuntimeError(error)}`,
        {toolName: 'take_screenshot'},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'screenshot',
  description: 'Screenshot tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './screenshot.js',
      handlerName: 'takeScreenshot',
    },
  ],
} satisfies DomainManifest;
