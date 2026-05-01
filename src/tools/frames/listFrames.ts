/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';

import type {FrameInfo, ListFramesResult} from './types.js';

/**
 * 计算 Frame 的嵌套深度。
 */
function getFrameDepth(frame: Frame): number {
  let depth = 0;
  let parent = frame.parentFrame();
  while (parent) {
    depth += 1;
    parent = parent.parentFrame();
  }
  return depth;
}

/**
 * 列出页面中所有 Frame（包括 iframe）。
 *
 * 遍历 Page 上的所有 Frame，返回每个 Frame 的索引、URL、名称和嵌套深度。
 *
 * @returns 结构化结果对象，data 包含 Frame 信息列表
 */
export async function listFrames(): Promise<ListFramesResult> {
  const tooltype = 'list_frames';

  try {
    const page = getRuntime().contextProvider!.getSelectedPage();
    if (!page) {
      return {
        success: false,
        message: '没有可用的页面，请先导航到目标页面',
        tooltype,
        data: [],
      };
    }

    const frames = page.frames();

    if (frames.length === 0) {
      return {
        success: true,
        message: 'No frames found.',
        tooltype,
        data: [],
      };
    }

    const selectedFrame = getRuntime().contextProvider!.getSelectedFrame();
    const frameInfos: FrameInfo[] = frames.map((frame, index) => {
      const depth = getFrameDepth(frame);
      const name = frame.name() || undefined;
      const isSelected = frame === selectedFrame;
      return {
        index,
        url: frame.url() || '(empty)',
        ...(name ? {name} : {}),
        depth,
        ...(isSelected ? {selected: true} : {}),
      };
    });

    return {
      success: true,
      message: `找到 ${frameInfos.length} 个 Frame`,
      tooltype,
      logFormat: 'full',
      data: frameInfos,
    };
  } catch (error) {
    return {
      success: false,
      message: `列出 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
