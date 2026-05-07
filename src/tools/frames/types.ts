/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

/** list_frames 返回的 data 结构 */
export interface ListFramesData {
  frameInfos: FrameInfo[];
  selectedIndex: number;
}

/** select_frame 返回的 data 结构 */
export interface SelectFrameData {
  selectedIndex: number;
  selectedName?: string;
}
