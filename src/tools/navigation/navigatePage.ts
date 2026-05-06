/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {resolveActivePage} from '../shared/activePageResolver.js';
import {explainPageError} from '../shared/pageDiagnostics.js';

import type {ToolContextProvider} from '../../worker/ToolContextProvider.js';

// Default navigation timeout in milliseconds (10 seconds)
const DEFAULT_NAV_TIMEOUT = 10_000;

type NavType = 'url' | 'back' | 'forward' | 'reload';

const actionLabel: Record<NavType, string> = {
  url: '导航到',
  back: '后退导航',
  forward: '前进导航',
  reload: '刷新页面',
};

/**
 * 导航当前页面，支持 URL 导航、前进、后退、刷新操作。
 */
export const navigatePage = defineTool({
  name: 'navigate_page',
  description:
    'Navigate the current page. Supports URL navigation, back, forward, and reload. Waits for DOMContentLoaded event.',
  annotations: {
    title: '导航页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    type: zod
      .enum(['url', 'back', 'forward', 'reload'])
      .optional()
      .describe('导航类型（默认 url）。'),
    url: zod
      .string()
      .optional()
      .describe('目标 URL（仅 type=url 时使用）。'),
    ignoreCache: zod
      .boolean()
      .optional()
      .describe('是否忽略缓存（仅 reload 时使用）。'),
    timeout: zod
      .number()
      .int()
      .optional()
      .describe('导航超时（毫秒），默认 10000。'),
  },
  handler: async (request, response, context) => {
    const runtime = context as unknown as ToolContextProvider;
    const navType: NavType = request.params.type ?? 'url';
    const timeout = request.params.timeout ?? DEFAULT_NAV_TIMEOUT;
    const options = {timeout, waitUntil: 'domcontentloaded' as const};

    if (navType === 'url' && !request.params.url) {
      throw new Error('导航类型为 url 时必须提供 url 参数。');
    }

    const resolvedPage = resolveActivePage(runtime);
    if (!resolvedPage.ok) {
      response.appendResponseLine(resolvedPage.message);
      return;
    }

    const page = resolvedPage.page;

    try {
      switch (navType) {
        case 'url':
          await page.goto(request.params.url!, options);
          break;
        case 'back':
          await page.goBack(options);
          break;
        case 'forward':
          await page.goForward(options);
          break;
        case 'reload':
          if (request.params.ignoreCache) {
            const client = await page.context().newCDPSession(page);
            await client.send('Page.reload', {ignoreCache: true});
          } else {
            await page.reload(options);
          }
          break;
      }

      response.appendResponseLine(
        `已${actionLabel[navType]}${navType === 'url' ? ` ${request.params.url}` : ''}，当前 URL: ${page.url()}`,
      );
    } catch (error) {
      response.appendResponseLine(explainPageError(error, '导航'));
    }
  },
});
