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
    const page = await runtime.getActivePage();
    const format = params.format || 'png';
    const quality = format === 'png' ? undefined : params.quality;

    // 自动创建截图目录
    if (params.filePath) {
      const dir = path.dirname(params.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
      }
    }

    const buffer = await page.screenshot({
      type: format,
      fullPage: params.fullPage,
      quality,
      optimizeForSpeed: true,
      path: params.filePath,
    });

    const screenshotBuffer = Buffer.from(buffer);

    if (params.filePath) {
      return {
        success: true,
        message: params.fullPage
          ? `全页截图已保存: ${params.filePath}`
          : `视口截图已保存: ${params.filePath}`,
        tooltype: 'take_screenshot',
        logFormat: 'json',
        data: {
          format,
          fullPage: params.fullPage || false,
          filePath: params.filePath,
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
      message: `截图失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'take_screenshot',
      logFormat: 'json',
    };
  }
}
