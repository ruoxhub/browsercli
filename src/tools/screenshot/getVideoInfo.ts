/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GetVideoInfoParams,
  GetVideoInfoResult,
} from './types.js';

import {getRuntime} from '../../runtime.js';

/**
 * 获取视频元素信息（纯函数版本）。
 *
 * 通过 CSS 选择器定位视频元素，返回 duration、currentTime、paused、src。
 *
 * @param runtime - Screenshot 运行时服务
 * @param params - 视频信息参数（selector）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function getVideoInfo(
  params: GetVideoInfoParams,
): Promise<GetVideoInfoResult> {
  try {
    const page = await getRuntime().contextProvider!.getActivePage();
    const info = await page.evaluate(sel => {
      const video = document.querySelector(sel) as HTMLVideoElement;
      if (!video) return null;
      return {
        duration: video.duration,
        currentTime: video.currentTime,
        paused: video.paused,
        src: video.src,
      };
    }, params.selector);

    if (!info) {
      return {
        success: false,
        message: `视频元素未找到: ${params.selector}`,
        tooltype: 'get_video_info',
        logFormat: 'json',
      };
    }

    return {
      success: true,
      message: `视频信息获取成功: ${params.selector}`,
      tooltype: 'get_video_info',
      logFormat: 'json',
      data: {
        selector: params.selector,
        ...info,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `获取视频信息失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_video_info',
      logFormat: 'json',
    };
  }
}
