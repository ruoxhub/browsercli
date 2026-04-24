/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import type {
  ScreenshotRuntimeServices,
  TakeScreenshotParams,
  TakeScreenshotResult,
} from './types.js';
import {
  getActivePageWithGuard,
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';

/**
 * 截图页面（纯函数版本）。
 *
 * 截取当前页面视口或全页截图，支持保存到文件或返回 base64。
 *
 * @param runtime - Screenshot 运行时服务
 * @param params - 截图参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function takeScreenshot(
  runtime: ScreenshotRuntimeServices,
  params: TakeScreenshotParams = {},
): Promise<TakeScreenshotResult> {
  try {
    const page = await getActivePageWithGuard(runtime);
    const format = params.format || 'png';
    const quality = format === 'png' ? undefined : params.quality;
    if (quality !== undefined && (quality < 0 || quality > 100)) {
      throw new Error(`quality 必须在 0-100 之间，收到: ${quality}`);
    }

    // 自动创建截图目录
    const resolvedFilePath = params.filePath
      ? path.resolve(params.filePath)
      : undefined;
    if (resolvedFilePath) {
      const dir = path.dirname(resolvedFilePath);
      fs.mkdirSync(dir, {recursive: true});
    }

    const buffer = await withOperationTimeout(
      page.screenshot({
        type: format as 'png' | 'jpeg',
        fullPage: params.fullPage,
        quality,
        optimizeForSpeed: true,
        path: resolvedFilePath,
      }),
      '执行截图',
    );

    const screenshotBuffer = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer);

    if (resolvedFilePath) {
      return {
        success: true,
        message: params.fullPage
          ? `全页截图已保存: ${resolvedFilePath}`
          : `视口截图已保存: ${resolvedFilePath}`,
        tooltype: 'take_screenshot',
        logFormat: 'json',
        data: {
          format,
          fullPage: params.fullPage || false,
          filePath: resolvedFilePath,
          size: screenshotBuffer.length,
        },
      };
    }

    return {
      success: true,
      message: params.fullPage
        ? '全页截图完成'
        : '视口截图完成',
      tooltype: 'take_screenshot',
      logFormat: 'json',
      data: {
        format,
        fullPage: params.fullPage || false,
        base64: screenshotBuffer.toString('base64'),
        mimeType: `image/${format}`,
        size: screenshotBuffer.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `截图失败: ${normalizeBrowserRuntimeError(error)}`,
      tooltype: 'take_screenshot',
      logFormat: 'json',
    };
  }
}
