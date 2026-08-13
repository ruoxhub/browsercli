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
    pageId: zod
      .string()
      .min(1)
      .optional()
      .describe('稳定页面 ID（从 list_pages 获取）。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('兼容页面索引（从 list_pages 获取）。'),
  },
  handler: async (request, response, context) => {
    const {pageId, pageIdx} = request.params;

    if (pageId === undefined && pageIdx === undefined) {
      response.setStructuredContent({
        success: false,
        message: '请至少提供 pageId 或 pageIdx',
        tooltype: 'select_page',
        data: {},
      });
      return;
    }

    const resolved = context.resolvePage({pageId, pageIdx});
    const page = resolved.page;
    await context.bringPageToFront(page);
    context.selectPage(page);
    context.syncPageContext(page);

    let title: string;
    try {
      title = await withOperationTimeout(
        page.title(),
        `读取页面 ${resolved.pageIdx} 标题`,
      );
    } catch (error) {
      title = `[unavailable] ${normalizeBrowserRuntimeError(error)}`;
    }

    response.setStructuredContent({
      success: true,
      message: `已选择页面 ${resolved.pageIdx}`,
      tooltype: 'select_page',
      data: {
        selectedIndex: resolved.pageIdx,
        selectedPageId: resolved.pageId,
        url: page.url(),
        title,
      },
    });
  },
});
