/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {type PreloadPreset, getPreloadPreset} from '../script/preload-presets.js';

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
    preloadHook: zod.string().optional().describe('在页面加载前注入的 hook 脚本'),
    preloadPreset: zod.enum(['capture-all-fetch', 'capture-all-xhr', 'capture-all-requests', 'log-cookies']).optional().describe('预设 hook 模板'),
  },
  handler: async (request, response, context) => {
    const {url, timeout, preloadHook, preloadPreset} = request.params;

     try {
       const page = await context.newPage();
       context.selectPage(page);
       context.syncPageContext(page);

       // 注入预加载 hook（在 goto 之前）
       const hookCode = preloadPreset
         ? getPreloadPreset(preloadPreset as PreloadPreset)
         : preloadHook;
       if (hookCode) {
         await page.addInitScript(hookCode);
       }

       await page.goto(url, {
         timeout: timeout ?? DEFAULT_NAV_TIMEOUT,
         waitUntil: 'domcontentloaded',
       });

       const pages = context.getPages();
       const index = pages.indexOf(page);
       const pageIndex = index >= 0 ? index : pages.length - 1;

       response.setStructuredContent({
         success: true,
         message: `已创建新页面并导航到 ${url}`,
         tooltype: 'new_page',
         data: {
           index: pageIndex,
           url: page.url(),
           title: await page.title(),
         }
       });
     } catch (error) {
       response.setStructuredContent({
         success: false,
         message: `创建新页面失败：${error instanceof Error ? error.message : String(error)}`,
         tooltype: 'new_page',
         data: {}
       });
     }
  },
});
