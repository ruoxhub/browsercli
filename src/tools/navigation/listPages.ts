/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';

import type {
  ListPagesParams,
  ListPagesResult,
  ListPagesData,
  NavigationRuntimeServices,
  PageInfo,
} from './types.js';

/**
 * 列出浏览器中所有已打开的页面（纯函数版本）。
 *
 * 遍历所有页面，返回每个页面的索引、URL 和标题，
 * 以及当前选中页面的索引。
 *
 * @param runtime - Navigation 运行时服务
 * @param _params - 无参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function listPages(
  runtime: NavigationRuntimeServices,
  _params?: ListPagesParams,
): Promise<ListPagesResult> {
  const tooltype = 'list_pages';

  try {
    const pages = runtime.getPages();
    const selectedPage = runtime.getSelectedPage();
    let unavailableTitleCount = 0;
    const pageInfos: PageInfo[] = [];
    for (const [index, page] of pages.entries()) {
      let title: string;
      try {
        title = await withOperationTimeout(page.title(), `读取页面 ${index} 标题`);
      } catch (error) {
        unavailableTitleCount += 1;
        title = `[unavailable] ${normalizeBrowserRuntimeError(error)}`;
      }
      pageInfos.push({
        index,
        url: page.url(),
        title,
      });
    }

    const selectedIndex = pages.indexOf(selectedPage);

    const data: ListPagesData = {
      pages: pageInfos,
      selectedIndex,
    };

    return {
      success: true,
      message:
        unavailableTitleCount > 0
          ? `找到 ${pageInfos.length} 个页面，其中 ${unavailableTitleCount} 个页面标题不可用`
          : `找到 ${pageInfos.length} 个页面`,
      tooltype,
      logFormat: 'full',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `列出页面失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      logFormat: 'simple',
    };
  }
}
