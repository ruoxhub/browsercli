/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  NewPageParams,
  NewPageResult,
  NewPageData,
} from './types.js';

// Default navigation timeout in milliseconds (10 seconds)
const DEFAULT_NAV_TIMEOUT = 10_000;

/**
 * 创建新页面并导航到指定 URL（纯函数版本）。
 *
 * 等待 DOMContentLoaded 事件（非完整页面加载）。
 *
 * @param params - 创建参数 { url, timeout? }
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function newPage(
  params: NewPageParams,
): Promise<NewPageResult> {
  const {url, timeout} = params;
  const tooltype = 'new_page';

  try {
    const page = await getRuntime().contextProvider!.newPage();

    // 自动选中新创建的页面
    getRuntime().contextProvider!.selectPage(page);
    getRuntime().contextProvider!.syncPageContext?.(page);

    await page.goto(url, {
      timeout: timeout ?? DEFAULT_NAV_TIMEOUT,
      waitUntil: 'domcontentloaded',
    });

    const pages = getRuntime().contextProvider!.getPages();
    const index = pages.indexOf(page);

    const data: NewPageData = {
      index: index >= 0 ? index : pages.length - 1,
      url: page.url(),
      title: await page.title(),
    };

    return {
      success: true,
      message: `已创建新页面并导航到 ${url}`,
      tooltype,
      logFormat: 'simple',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `创建新页面失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      logFormat: 'simple',
    };
  }
}
