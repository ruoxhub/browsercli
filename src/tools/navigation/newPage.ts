/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

// Default navigation timeout in milliseconds (10 seconds)
const DEFAULT_NAV_TIMEOUT = 10_000;

/**
 * 创建新页面并导航到指定 URL。
 */
export const newPage = defineTool({
  name: 'new_page',
  description:
    'Create a new browser page and navigate to the specified URL. The new page will be automatically selected.',
  annotations: {
    title: '新建页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().describe('要加载的 URL。'),
    timeout: zod
      .number()
      .int()
      .optional()
      .describe('导航超时（毫秒），默认 10000。'),
  },
  handler: async (request, response, context) => {
    const {url, timeout} = request.params;

    try {
      const page = await context.newPage();
      context.selectPage(page);
      context.syncPageContext(page);

      await page.goto(url, {
        timeout: timeout ?? DEFAULT_NAV_TIMEOUT,
        waitUntil: 'domcontentloaded',
      });

      const pages = context.getPages();
      const index = pages.indexOf(page);

      response.appendResponseLine(`已创建新页面并导航到 ${url}`);
      response.appendResponseLine(
        `页面索引: ${index >= 0 ? index : pages.length - 1}`,
      );
      response.appendResponseLine(`标题: ${await page.title()}`);
    } catch (error) {
      response.appendResponseLine(
        `创建新页面失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
