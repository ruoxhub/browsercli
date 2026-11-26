/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../modules/browser/cdpUtils.js';
import {zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';
import type {ToolContextProvider} from '../worker/ToolContext.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {getPreloadPreset, type PreloadPreset} from './script.js';
import {resolveActivePage} from './shared/activePageResolver.js';
import {
  normalizeBrowserRuntimeError,
  withDebuggerTrapBypass,
  withOperationTimeout,
} from './shared/browserRuntime.js';
import {explainPageError} from './shared/pageDiagnostics.js';
import {
  CLOSE_PAGE_ERROR,
  defineBrowserTool,
  definePageTool,
} from './ToolDefinition.js';

// ─── closePage.ts ────────────────────────────────────────

/**
 * 关闭指定页面（支持 pageId 或 pageIdx）。最后一个页面不允许关闭。
 */
export const closePage = defineBrowserTool({
  name: 'close_page',
  description:
    '关闭指定页面（支持 pageId 或 pageIdx）。浏览器中的最后一个打开页面无法关闭。',
  annotations: {
    title: '关闭页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  concurrency: 'exclusive',
  blockedByDialog: false,
  schema: {
    pageId: zod
      .string()
      .min(1)
      .optional()
      .describe('要关闭的稳定页面 ID（来自 list_pages）。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('要关闭的页面索引（从 0 开始，来自 list_pages）。'),
  },
  handler: async (request, response, context) => {
    const {pageId, pageIdx} = request.params;

    if (pageId === undefined && pageIdx === undefined) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        '请至少提供 pageId 或 pageIdx',
        {toolName: 'close_page'},
      );
    }

    try {
      if (context.closePageBySelector) {
        await context.closePageBySelector({pageId, pageIdx});
      } else {
        const resolved = context.resolvePage({pageId, pageIdx});
        await context.closePage(resolved.pageIdx);
      }

      response.setIncludePages(true);
      response.setStructuredContent({
        success: true,
        message: '页面已关闭',
        tooltype: 'close_page',
        data: {
          ...(pageId !== undefined ? {pageId} : {}),
          ...(pageIdx !== undefined ? {pageIdx} : {}),
          closed: true,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === CLOSE_PAGE_ERROR) {
        response.appendResponseLine(msg);
        response.setIncludePages(true);
        response.setStructuredContent({
          success: true,
          message: msg,
          tooltype: 'close_page',
          data: {closed: false, lastPageProtected: true},
        });
        return;
      }
      throw createToolError(ErrorCodes.RUNTIME, `关闭页面失败：${msg}`, {
        toolName: 'close_page',
        pageId,
        pageIdx,
      });
    }
  },
});

// ─── listPages.ts ────────────────────────────────────────

/**
 * 列出浏览器中所有已打开的页面。
 */
export const listPages = defineBrowserTool({
  name: 'list_pages',
  concurrency: 'none',
  description:
    '列出浏览器中所有已打开的页面及其稳定 pageId、URL 与标题。调用页级工具时可通过 --pageId 指定标签页，或用 select_page 切换默认页面。',
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
      let selectedPage: ReturnType<typeof context.getSelectedPage> | null =
        null;
      try {
        selectedPage = context.getSelectedPage();
      } catch {
        selectedPage = null;
      }
      const pageInfos: Array<{
        pageId: string;
        url: string;
        title: string;
      }> = [];

      for (const page of pages) {
        const pageId = context.getPageId(page);
        let title: string;
        try {
          title = await withOperationTimeout(
            page.title(),
            `读取页面 ${pageId} 标题`,
          );
        } catch (error) {
          title = `[unavailable] ${normalizeBrowserRuntimeError(error)}`;
        }
        pageInfos.push({
          pageId,
          url: page.url(),
          title,
        });
      }

      const selectedPageId =
        selectedPage && pages.includes(selectedPage)
          ? context.getPageId(selectedPage)
          : null;

      if (pageInfos.length === 0) {
        const isConnected =
          typeof context.isBrowserConnected === 'function'
            ? context.isBrowserConnected()
            : true;
        response.setStructuredContent({
          success: true,
          message: isConnected
            ? '当前没有打开的页面。'
            : '当前没有打开的页面（浏览器连接已丢失或未连接，可使用 "browsercli start" 重新连接）。',
          tooltype: 'list_pages',
          data: {
            pageInfos: [],
            selectedPageId,
            browserConnected: isConnected,
          },
        });
        return;
      }

      data = {
        pageInfos,
        selectedPageId,
        browserConnected:
          typeof context.isBrowserConnected === 'function'
            ? context.isBrowserConnected()
            : true,
      };

      response.setStructuredContent({
        success: true,
        message: '',
        tooltype: 'list_pages',
        data: data,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `列出页面失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'list_pages'},
      );
    }
  },
});

// ─── navigatePage.ts ─────────────────────────────────────

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
export const navigatePage = definePageTool({
  name: 'navigate_page',
  description:
    '导航当前页面，支持 URL 导航、后退、前进与刷新，支持注入 initScript 与自动处理 beforeunload 弹窗。',
  annotations: {
    title: '导航页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  blockedByDialog: false,
  concurrency: 'page',
  schema: {
    type: zod
      .enum(['url', 'back', 'forward', 'reload'])
      .optional()
      .describe('导航类型（默认 url）。'),
    url: zod.string().optional().describe('目标 URL（仅 type=url 时使用）。'),
    ignoreCache: zod
      .boolean()
      .optional()
      .describe('是否忽略缓存（仅 reload 时使用）。'),
    handleBeforeUnload: zod
      .enum(['accept', 'decline'])
      .optional()
      .describe(
        '遇到 beforeunload 离开确认弹窗时的默认处理动作（accept 或 decline）。',
      ),
    initScript: zod
      .string()
      .optional()
      .describe('在页面文档执行前注入的初始化 JavaScript 脚本。'),
    timeout: zod
      .number()
      .int()
      .optional()
      .describe('导航超时（毫秒），默认 10000。'),
  },
  handler: async (request, response, context) => {
    // SAFETY: ToolContext 提供者在运行时保证注入的 context 实现了 ToolContextProvider 协议接口
    const runtime = context as unknown as ToolContextProvider;
    const navType: NavType = request.params.type ?? 'url';
    const timeout = request.params.timeout ?? DEFAULT_NAV_TIMEOUT;
    const {handleBeforeUnload, initScript} = request.params;
    const options = {timeout, waitUntil: 'domcontentloaded' as const};

    if (navType === 'url' && !request.params.url) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        '导航类型为 url 时必须提供 url 参数。',
        {toolName: 'navigate_page'},
      );
    }

    const resolvedPage = resolveActivePage(runtime);
    if (!resolvedPage.ok) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        (resolvedPage as {message: string}).message,
        {toolName: 'navigate_page'},
      );
    }

    const page = resolvedPage.page;

    try {
      const performNavigate = async () => {
        if (initScript) {
          await page.addInitScript(initScript);
        }
        await withDebuggerTrapBypass(context, async () => {
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
                await withCdpSession(page, async client => {
                  await client.send('Page.reload', {ignoreCache: true});
                });
              } else {
                await page.reload(options);
              }
              break;
          }
        });
      };

      if (
        handleBeforeUnload !== undefined &&
        typeof context.waitForEventsAfterAction === 'function'
      ) {
        const waitResult = await context.waitForEventsAfterAction(
          performNavigate,
          {
            timeout,
            handleDialog:
              handleBeforeUnload === 'accept' ? 'accept' : 'dismiss',
          },
        );
        if (waitResult && response.attachWaitForResult) {
          response.attachWaitForResult(waitResult);
        }
      } else {
        await performNavigate();
      }

      response.setStructuredContent({
        success: true,
        message: `已${actionLabel[navType]}${navType === 'url' ? ` ${request.params.url}` : ''}`,
        tooltype: 'navigate_page',
        data: {
          type: navType,
          url: page.url(),
          navigated: true,
        },
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        explainPageError(error, '导航'),
        {toolName: 'navigate_page', type: navType, url: page.url()},
      );
    }
  },
});

// ─── newPage.ts ──────────────────────────────────────────

/**
 * 创建新页面并导航到指定 URL。
 */
export const newPage = defineBrowserTool({
  name: 'new_page',
  description:
    '创建新的浏览器页面并导航到指定 URL；默认自动选中新页面，也可在后台或独立上下文中打开。',
  annotations: {
    title: '新建页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  schema: {
    url: zod.string().describe('要加载的 URL。'),
    timeout: zod
      .number()
      .int()
      .optional()
      .describe('导航超时（毫秒），默认 10000。'),
    background: zod
      .boolean()
      .optional()
      .describe(
        '是否在后台创建页面而不切换到前台/不设为当前选中页（默认 false）。',
      ),
    isolatedContext: zod
      .string()
      .optional()
      .describe('可选：隔离浏览器上下文名称（独立 Cookie 与本地存储）。'),
    preloadHook: zod
      .string()
      .optional()
      .describe('在页面加载前注入的 hook 脚本'),
    preloadPreset: zod
      .enum([
        'capture-all-fetch',
        'capture-all-xhr',
        'capture-all-requests',
        'log-cookies',
      ])
      .optional()
      .describe('预设 hook 模板'),
  },
  handler: async (request, response, context) => {
    const {
      url,
      timeout,
      background,
      isolatedContext,
      preloadHook,
      preloadPreset,
    } = request.params;

    try {
      const hasOptions =
        background !== undefined || isolatedContext !== undefined;
      const page = hasOptions
        ? await context.newPage({background, isolatedContext})
        : await context.newPage();
      if (!background) {
        context.selectPage(page);
        context.syncPageContext(page);
      }

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

      const pageId = context.getPageId(page);

      response.setStructuredContent({
        success: true,
        message: `已创建新页面并导航到 ${url}`,
        tooltype: 'new_page',
        data: {
          pageId,
          url: page.url(),
          title: await page.title(),
          ...(background !== undefined ? {background} : {}),
          ...(isolatedContext !== undefined ? {isolatedContext} : {}),
        },
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `创建新页面失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'new_page', url},
      );
    }
  },
});

// ─── selectPage.ts ───────────────────────────────────────

/**
 * 按索引或页面 ID 选择页面并切换当前上下文，默认不切换浏览器前台标签（与 chrome-devtools 对齐）。
 */
export const selectPage = defineBrowserTool({
  name: 'select_page',
  description:
    '按 pageId 选择页面并将其设为当前上下文，可选是否把窗口带到前台（默认不切换前台标签）。请先使用 list_pages 获取 pageId。',
  annotations: {
    title: '选择页面',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  schema: {
    pageId: zod
      .string()
      .min(1)
      .optional()
      .describe('稳定页面 ID（来自 list_pages，如 1、2）。'),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('兼容参数：按 0-based 页面位置索引选择（推荐使用 pageId）。'),
    bringToFront: zod
      .boolean()
      .optional()
      .describe('是否将选中页面带到前台聚焦（默认 false）。'),
  },
  handler: async (request, response, context) => {
    const {pageId, pageIdx, bringToFront = false} = request.params;

    if (pageId === undefined && pageIdx === undefined) {
      throw createToolError(
        ErrorCodes.VALIDATION,
        '请至少提供 pageId 或 pageIdx',
        {toolName: 'select_page'},
      );
    }

    try {
      const resolved = context.resolvePage({pageId, pageIdx});
      const page = resolved.page;
      context.selectPage(page);
      context.syncPageContext(page);
      if (bringToFront) {
        await context.bringPageToFront(page);
      }

      let title: string;
      try {
        title = await withOperationTimeout(
          page.title(),
          `读取页面 ${resolved.pageId} 标题`,
        );
      } catch (error) {
        title = `[unavailable] ${normalizeBrowserRuntimeError(error)}`;
      }

      response.setStructuredContent({
        success: true,
        message: `已选择页面 ${resolved.pageId}`,
        tooltype: 'select_page',
        data: {
          selectedPageId: resolved.pageId,
          url: page.url(),
          title,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.NOT_FOUND,
        `选择页面失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'select_page', pageId, pageIdx},
      );
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'navigation',
  description: 'Browser page navigation tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './navigation.js', handlerName: 'listPages'},
    {modulePath: './navigation.js', handlerName: 'selectPage'},
    {modulePath: './navigation.js', handlerName: 'newPage'},
    {modulePath: './navigation.js', handlerName: 'navigatePage'},
    {modulePath: './navigation.js', handlerName: 'closePage'},
  ],
} satisfies DomainManifest;
