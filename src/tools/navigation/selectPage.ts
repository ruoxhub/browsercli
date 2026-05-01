/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  SelectPageParams,
  SelectPageResult,
  SelectPageData,
} from './types.js';

/**
 * 按索引选择页面（纯函数版本）。
 *
 * 将指定索引的页面带到前台并切换上下文。
 *
 * @param params - 选择参数 { pageIdx }
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function selectPage(
  params: SelectPageParams,
): Promise<SelectPageResult> {
  const {pageIdx} = params;
  const tooltype = 'select_page';

  try {
    const page = getRuntime().contextProvider!.getPageByIdx(pageIdx);
    await getRuntime().contextProvider!.bringPageToFront(page);
    getRuntime().contextProvider!.selectPage(page);
    getRuntime().contextProvider!.syncPageContext?.(page);

    const data: SelectPageData = {
      selectedIndex: pageIdx,
      url: page.url(),
      title: await page.title(),
    };

    return {
      success: true,
      message: `已选择页面 ${pageIdx}: ${page.url()}`,
      tooltype,
      logFormat: 'simple',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `选择页面失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      logFormat: 'simple',
    };
  }
}
