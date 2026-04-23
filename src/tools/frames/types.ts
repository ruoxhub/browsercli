/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

/**
 * Frames 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface FramesResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/** Frame 条目信息 */
export interface FrameInfo {
  /** 在 page.frames() 中的索引 */
  index: number;
  /** Frame URL */
  url: string;
  /** Frame name（可能为空） */
  name?: string;
  /** 嵌套深度（0 = 主 frame） */
  depth: number;
  /** 是否为当前选中的 Frame */
  selected?: boolean;
}

/** listFrames 结果 */
export interface ListFramesResult extends FramesResult {
  tooltype: 'list_frames';
  data?: FrameInfo[];
}

/** selectFrame 参数 */
export interface SelectFrameParams {
  /** frame 索引（0 = 主 frame） */
  frameIdx: number;
}

/** selectFrame 结果 */
export interface SelectFrameResult extends FramesResult {
  tooltype: 'select_frame';
  data?: FrameInfo;
}

/** 重新导出 Page 类型 */
export type {Page};
