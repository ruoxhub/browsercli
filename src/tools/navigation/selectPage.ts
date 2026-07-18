/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 按索引选择页面，将指定页面带到前台并切换上下文。
 */
export const selectPage = defineTool({
  name: 'select_page',
  description:
    '按索引选择页面并将其带到前台、切换上下文。请先使用 list_pages 获取页面索引。',
  annotations: {
    title: '选择页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    pageIdx: zod.number().int().describe('页面索引（从 list_pages 获取）.'),
  },
  handler: async (request, response, context) => {
    const {pageIdx} = request.params;

    const page = context.getPageByIdx(pageIdx);
    await context.bringPageToFront(page);
    context.selectPage(page);
    context.syncPageContext(page);

    let title: string;
    try {
      title = await withOperationTimeout(
        page.title(),
        `读取页面 ${pageIdx} 标题`,
      );
    } catch (error) {
      title = `[unavailable] ${normalizeBrowserRuntimeError(error)}`;
    }

    response.setStructuredContent({
      success: true,
      message: `已选择页面 ${pageIdx}`,
      tooltype: 'select_page',
      data: {
        selectedIndex: pageIdx,
        url: page.url(),
        title,
      },
    });
  },
});
