/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ToolCategory} from '../categories.js';
import {
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 列出浏览器中所有已打开的页面。
 */
export const listPages = defineTool({
  name: 'list_pages',
  description:
    '列出浏览器中所有已打开的页面及其索引、URL 与标题。在调用 select_page 前可先使用本工具查找页面索引。',
  annotations: {
    title: '列出页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (request, response, context) => {
    let data;
    try {
      const pages = context.getPages();
      // getSelectedPage 未选中页面时返回 null；list_pages 工具设计上
      // 不依赖选中页（schema 为空），所以降级为 selectedIndex=-1。
      let selectedPage: ReturnType<typeof context.getSelectedPage> | null =
        null;
      try {
        selectedPage = context.getSelectedPage();
      } catch {
        selectedPage = null;
      }
      const pageInfos: Array<{index: number; url: string; title: string}> = [];

      for (const [index, page] of pages.entries()) {
        let title: string;
        try {
          title = await withOperationTimeout(
            page.title(),
            `读取页面 ${index} 标题`,
          );
        } catch (error) {
          title = `[unavailable] ${normalizeBrowserRuntimeError(error)}`;
        }
        pageInfos.push({
          index,
          url: page.url(),
          title,
        });
      }

      const selectedIndex = selectedPage ? pages.indexOf(selectedPage) : -1;

      if (pageInfos.length === 0) {
        response.setStructuredContent({
          success: true,
          message: '当前没有打开的页面。',
          tooltype: 'list_pages',
          data: {pageInfos: [], selectedIndex},
        });
        return;
      }

      data = {
        pageInfos,
        selectedIndex,
      };

      response.setStructuredContent({
        success: true,
        message: '',
        tooltype: 'list_pages',
        data: data,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `列出页面失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_pages',
        data: {},
      });
    }
  },
});
