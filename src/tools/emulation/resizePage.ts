/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {ResizePageParams, ResizePageResult} from './types.js';

/**
 * 调整页面窗口尺寸。
 *
 * 在 Playwright Frame 对应的 Page 上设置视口大小，
 * 用于测试响应式布局和移动端视图。
 *
 * @param frame - Playwright Frame 对象，用于获取 Page 并调整视口
 * @param params - 页面尺寸参数
 * @returns 结构化结果对象
 */
export async function resizePage(
  frame: Frame,
  params: ResizePageParams,
): Promise<ResizePageResult> {
  const {width, height} = params;
  const tooltype = 'resize_page';
  const page = frame.page();

  try {
    await page.setViewportSize({width, height});
    return {
      success: true,
      message: `页面尺寸已调整为 ${width}x${height}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `页面尺寸调整失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
