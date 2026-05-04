/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';

import {
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

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
    const runtime = context as unknown as ToolContextProvider;

    try {
      const pages = runtime.getPages();
      const selectedPage = runtime.getSelectedPage();
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

      response.appendResponseLine(
        `共 ${pageInfos.length} 个页面${
          unavailableTitleCount > 0
            ? `，其中 ${unavailableTitleCount} 个标题不可用`
            : ''
        }：`,
      );
      response.appendResponseLine('');

      for (const info of pageInfos) {
        const marker = info.index === selectedIndex ? ' ← 选中' : '';
        response.appendResponseLine(
          `[${info.index}] ${info.url}${marker}`,
        );
        response.appendResponseLine(`    标题: ${info.title}`);
      }
    } catch (error) {
      response.appendResponseLine(
        `列出页面失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
