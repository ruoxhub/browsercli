/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Screenshot 纯函数 ──────────────────────────────────

export {takeScreenshot} from './takeScreenshot.js';
export {getVideoInfo} from './getVideoInfo.js';
export {seekVideo} from './seekVideo.js';
export {captureVideoFrame} from './captureVideoFrame.js';

// ─── 类型导出 ─────────────────────────────────────────

export type {
  ScreenshotRuntimeServices,
  TakeScreenshotParams,
  GetVideoInfoParams,
  SeekVideoParams,
  CaptureVideoFrameParams,
  TakeScreenshotData,
  GetVideoInfoData,
  SeekVideoData,
  CaptureVideoFrameData,
  ScreenshotResult,
  TakeScreenshotResult,
  GetVideoInfoResult,
  SeekVideoResult,
  CaptureVideoFrameResult,
} from './types.js';
