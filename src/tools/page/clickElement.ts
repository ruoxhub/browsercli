/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ClickElementParams,
  ClickElementResult,
  PageRuntimeServices,
} from './types.js';

/**
 * 点击页面元素（纯函数版本）。
 *
 * 通过 CSS 选择器定位元素并点击。
 *
 * @param runtime - Page 运行时服务
 * @param params - 点击参数（selector）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function clickElement(
  runtime: PageRuntimeServices,
  params: ClickElementParams,
): Promise<ClickElementResult> {
  try {
    const page = await runtime.getActivePage();
    await page.click(params.selector);

    return {
      success: true,
      message: `元素已点击: ${params.selector}`,
      tooltype: 'click_element',
      logFormat: 'json',
      data: {
        selector: params.selector,
        clicked: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `点击元素失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'click_element',
      logFormat: 'json',
      data: {
        selector: params.selector,
        clicked: false,
      },
    };
  }
}
