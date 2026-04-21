/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ScreenshotRuntimeServices,
  SeekVideoParams,
  SeekVideoResult,
} from './types.js';

/**
 * 定位视频到指定时间点（纯函数版本）。
 *
 * 通过 CSS 选择器定位视频元素，设置 currentTime。
 *
 * @param runtime - Screenshot 运行时服务
 * @param params - 视频定位参数（selector, time）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function seekVideo(
  runtime: ScreenshotRuntimeServices,
  params: SeekVideoParams,
): Promise<SeekVideoResult> {
  try {
    const page = await runtime.getActivePage();
    await page.evaluate(
      (sel, t) => {
        const video = document.querySelector(sel) as HTMLVideoElement;
        if (video) {
          video.currentTime = t;
        }
      },
      params.selector,
      params.time,
    );

    return {
      success: true,
      message: `视频已定位到 ${params.time}s: ${params.selector}`,
      tooltype: 'seek_video',
      logFormat: 'json',
      data: {
        selector: params.selector,
        time: params.time,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `视频定位失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'seek_video',
      logFormat: 'json',
    };
  }
}
