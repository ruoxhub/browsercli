/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import {getRuntime} from '../../runtime.js';

import type {FrameInfo, SelectFrameParams, SelectFrameResult} from './types.js';

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
 * 按索引选择页面中的 Frame，返回该 Frame 的信息。
 *
 * 验证索引有效性后，将选中的 Frame 同步到 ToolContextProvider，
 * 后续 frame callMode 的工具将在该 Frame 上执行。
 *
 * @param params - 选择参数 { frameIdx }
 * @returns 结构化结果对象，data 包含选中的 Frame 信息
 */
export async function selectFrame(
  params: SelectFrameParams,
): Promise<SelectFrameResult> {
  const {frameIdx} = params;
  const tooltype = 'select_frame';

  try {
    const page = getRuntime().contextProvider!.getSelectedPage();
    if (!page) {
      return {
        success: false,
        message: '没有可用的页面，请先导航到目标页面',
        tooltype,
      };
    }

    const frames = page.frames();

    if (frameIdx < 0 || frameIdx >= frames.length) {
      return {
        success: false,
        message: `无效的 Frame 索引 ${frameIdx}，可用范围 0-${frames.length - 1}`,
        tooltype,
      };
    }

    const frame = frames[frameIdx]!;
    const depth = getFrameDepth(frame);
    const name = frame.name() || undefined;
    const info: FrameInfo = {
      index: frameIdx,
      url: frame.url() || '(empty)',
      ...(name ? {name} : {}),
      depth,
    };

    // 同步选中的 Frame 到上下文
    getRuntime().contextProvider!.setSelectedFrame(frame);

    const label =
      frameIdx === 0
        ? '主 Frame'
        : `Frame ${frameIdx}: ${frame.url()}${name ? ` (name: "${name}")` : ''}`;

    return {
      success: true,
      message: `已选择 ${label}`,
      tooltype,
      logFormat: 'simple',
      data: info,
    };
  } catch (error) {
    return {
      success: false,
      message: `选择 Frame 失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
