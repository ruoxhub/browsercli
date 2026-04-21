/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {Page} from './types.js';
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
 * 验证索引有效性后，返回对应 Frame 的结构化信息。
 * 注意：此函数仅返回 Frame 信息，不修改任何上下文状态。
 * 如需切换执行上下文，仍需使用 select_frame 工具。
 *
 * @param page - Puppeteer Page 对象
 * @param params - 选择参数 { frameIdx }
 * @returns 结构化结果对象，data 包含选中的 Frame 信息
 */
export async function selectFrame(
  page: Page,
  params: SelectFrameParams,
): Promise<SelectFrameResult> {
  const {frameIdx} = params;
  const tooltype = 'select_frame';

  try {
    const frames = page.frames();

    if (frameIdx < 0 || frameIdx >= frames.length) {
      return {
        success: false,
        message: `无效的 Frame 索引 ${frameIdx}，可用范围 0-${frames.length - 1}`,
        tooltype,
      };
    }

    const frame = frames[frameIdx];
    const depth = getFrameDepth(frame);
    const name = frame.name() || undefined;
    const info: FrameInfo = {
      index: frameIdx,
      url: frame.url() || '(empty)',
      ...(name ? {name} : {}),
      depth,
    };

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
