/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

/**
 * 按索引选择页面，将指定页面带到前台并切换上下文。
 */
export const selectPage = defineTool({
  name: 'select_page',
  description:
    'Select a page by index to bring it to the foreground and switch context. Use list_pages first to find the page index.',
  annotations: {
    title: '选择页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    pageIdx: zod
      .number()
      .int()
      .describe('页面索引（从 list_pages 获取）.'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;
    const {pageIdx} = request.params;

    try {
      const page = runtime.getPageByIdx(pageIdx);
      await runtime.bringPageToFront(page);
      runtime.selectPage(page);
      runtime.syncPageContext(page);

      response.appendResponseLine(`已选择页面 ${pageIdx}: ${page.url()}`);
      response.appendResponseLine(`标题: ${await page.title()}`);
    } catch (error) {
      response.appendResponseLine(
        `选择页面失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
