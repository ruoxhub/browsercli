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
    'List all open browser pages with their index, URL and title. Use this to find the page index before calling select_page.',
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
      const selectedPage = context.getSelectedPage();
      let unavailableTitleCount = 0;
      const pageInfos: Array<{index: number; url: string; title: string}> = [];

      for (const [index, page] of pages.entries()) {
        let title: string;
        try {
          title = await withOperationTimeout(
            page.title(),
            `读取页面 ${index} 标题`,
          );
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

      const selectedIndex = pages.indexOf(selectedPage!);

      if (pageInfos.length === 0) {
        response.appendResponseLine('当前没有打开的页面。');
        return;
      }

       data = {
         pageInfos,
         selectedIndex
       };

       response.setStructuredContent({
         success: true,
         message: "",
         tooltype: 'list_pages',
         data: data
       });
     } catch (error) {
       response.setStructuredContent({
         success: false,
         message: `列出页面失败：${error instanceof Error ? error.message : String(error)}`,
         tooltype: 'list_pages',
         data: {}
       });
     }
  },
});
