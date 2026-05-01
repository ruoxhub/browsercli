/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  ScrollByParams,
  ScrollByResult,
} from './types.js';

/**
 * 按方向滚动页面（纯函数版本）。
 *
 * 支持 up/down/top/bottom 方向滚动，自动等待 800ms 触发懒加载内容。
 *
 * @param params - 滚动参数（direction, pixels）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function scrollBy(
  params: ScrollByParams,
): Promise<ScrollByResult> {
  try {
    const page = await getRuntime().contextProvider!.getActivePage();
    const pixels = params.pixels ?? 1000;

    const result = await page.evaluate(
      (dir, px) => {
        switch (dir) {
          case 'top':
            window.scrollTo(0, 0);
            return 'scrolled to top';
          case 'bottom':
            window.scrollTo(0, document.body.scrollHeight);
            return 'scrolled to bottom';
          case 'up':
            window.scrollBy(0, -Math.abs(px));
            return `scrolled up ${Math.abs(px)}px`;
          case 'down':
            window.scrollBy(0, Math.abs(px));
            return `scrolled down ${Math.abs(px)}px`;
        }
      },
      params.direction,
      pixels,
    );

    // 等待懒加载触发（800ms 与原工具一致）
    await new Promise(resolve => setTimeout(resolve, 800));

    return {
      success: true,
      message: `页面已滚动: ${params.direction}`,
      tooltype: 'scroll_by',
      logFormat: 'json',
      data: {
        direction: params.direction,
        pixels,
        result,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `滚动页面失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'scroll_by',
      logFormat: 'json',
      data: {
        direction: params.direction,
        pixels: params.pixels ?? 1000,
        result: '',
      },
    };
  }
}
