/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

// ─── 运行时服务接口 ──────────────────────────────────

/**
 * Screenshot 运行时服务（从 McpContext 提取的接口）。
 *
 * 纯函数通过此接口访问页面控制能力，
 * 调用方负责提供具体实现。
 */
export interface ScreenshotRuntimeServices {
  /** 获取当前活跃页面的 Puppeteer Page 对象 */
  getActivePage: () => Promise<Page>;
}

// ─── 参数类型 ──────────────────────────────────────────

/** takeScreenshot 参数 */
export interface TakeScreenshotParams {
  /** 截图格式 */
  format?: 'png' | 'jpeg' | 'webp';
  /** 压缩质量 (0-100)，仅 jpeg/webp 有效 */
  quality?: number;
  /** 是否全页截图 */
  fullPage?: boolean;
  /** 保存文件路径（可选） */
  filePath?: string;
}

/** getVideoInfo 参数 */
export interface GetVideoInfoParams {
  /** 视频元素 CSS 选择器 */
  selector: string;
}

/** seekVideo 参数 */
export interface SeekVideoParams {
  /** 视频元素 CSS 选择器 */
  selector: string;
  /** 定位时间（秒） */
  time: number;
}

/** captureVideoFrame 参数 */
export interface CaptureVideoFrameParams {
  /** 视频元素 CSS 选择器 */
  selector: string;
  /** 定位时间（秒），可选 */
  seekTime?: number;
  /** 输出文件路径（可选） */
  outputPath?: string;
  /** 图片格式 */
  format?: 'png' | 'jpeg';
  /** 图片质量 (0-100)，仅 jpeg 有效 */
  quality?: number;
}

// ─── 数据类型 ──────────────────────────────────────────

/** takeScreenshot 返回数据 */
export interface TakeScreenshotData {
  /** 截图格式 */
  format: string;
  /** 是否全页截图 */
  fullPage: boolean;
  /** 图片 base64（未保存文件时） */
  base64?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 保存的文件路径 */
  filePath?: string;
  /** 文件大小（字节） */
  size: number;
}

/** getVideoInfo 返回数据 */
export interface GetVideoInfoData {
  selector: string;
  duration: number;
  currentTime: number;
  paused: boolean;
  src: string;
}

/** seekVideo 返回数据 */
export interface SeekVideoData {
  selector: string;
  time: number;
}

/** captureVideoFrame 返回数据 */
export interface CaptureVideoFrameData {
  selector: string;
  /** 图片 base64（未保存文件时） */
  base64?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 保存的文件路径 */
  outputPath?: string;
  /** 文件大小（字节） */
  size: number;
  /** seek 时间（如有） */
  seekTime?: number;
}

// ─── 结果类型 ──────────────────────────────────────────

/**
 * Screenshot 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface ScreenshotResult<T = unknown> {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat: string;
  /** 结果数据 */
  data?: T;
}

/** takeScreenshot 结果 */
export interface TakeScreenshotResult
  extends ScreenshotResult<TakeScreenshotData> {
  tooltype: 'take_screenshot';
}

/** getVideoInfo 结果 */
export interface GetVideoInfoResult
  extends ScreenshotResult<GetVideoInfoData> {
  tooltype: 'get_video_info';
}

/** seekVideo 结果 */
export interface SeekVideoResult extends ScreenshotResult<SeekVideoData> {
  tooltype: 'seek_video';
}

/** captureVideoFrame 结果 */
export interface CaptureVideoFrameResult
  extends ScreenshotResult<CaptureVideoFrameData> {
  tooltype: 'capture_video_frame';
}
