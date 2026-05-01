/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

import type {
  CaptureVideoFrameParams,
  CaptureVideoFrameResult,
} from './types.js';

import {getRuntime} from '../../runtime.js';

/**
 * 捕获视频当前帧（纯函数版本）。
 *
 * 先 seek 到指定时间（可选），然后截取视频元素当前帧。
 *
 * @param runtime - Screenshot 运行时服务
 * @param params - 视频帧捕获参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function captureVideoFrame(
  params: CaptureVideoFrameParams,
): Promise<CaptureVideoFrameResult> {
  try {
    const page = await getRuntime().contextProvider!.getActivePage();

    // 先定位到指定时间点
    if (params.seekTime !== undefined) {
      await page.evaluate(
        (sel, t) => {
          const video = document.querySelector(sel) as HTMLVideoElement;
          if (video) {
            video.currentTime = t;
          }
        },
        params.selector,
        params.seekTime,
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
    }, params.selector);

    if (!videoBox) {
      return {
        success: false,
        message: `视频元素未找到: ${params.selector}`,
        tooltype: 'capture_video_frame',
        logFormat: 'json',
      };
    }

    const format = params.format || 'png';

    // 自动创建输出目录
    if (params.outputPath) {
      const dir = path.dirname(params.outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
      }
    }

    // 截图
    const buffer = await page.screenshot({
      path: params.outputPath,
      type: format,
      quality: params.quality,
      clip: {
        x: Math.round(videoBox.x),
        y: Math.round(videoBox.y),
        width: Math.round(videoBox.width),
        height: Math.round(videoBox.height),
      },
    });

    const frameBuffer = Buffer.from(buffer);

    if (params.outputPath) {
      return {
        success: true,
        message: `视频帧已捕获并保存: ${params.outputPath}`,
        tooltype: 'capture_video_frame',
        logFormat: 'json',
        data: {
          selector: params.selector,
          outputPath: params.outputPath,
          size: frameBuffer.length,
          seekTime: params.seekTime,
        },
      };
    }

    return {
      success: true,
      message: '视频帧已捕获',
      tooltype: 'capture_video_frame',
      logFormat: 'json',
      data: {
        selector: params.selector,
        base64: frameBuffer.toString('base64'),
        mimeType: `image/${format}`,
        size: frameBuffer.length,
        seekTime: params.seekTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `捕获视频帧失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'capture_video_frame',
      logFormat: 'json',
    };
  }
}
