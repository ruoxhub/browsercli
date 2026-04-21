/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  NavigatePageParams,
  NavigatePageResult,
  NavigatePageData,
  NavigationRuntimeServices,
} from './types.js';

// Default navigation timeout in milliseconds (10 seconds)
const DEFAULT_NAV_TIMEOUT = 10_000;

type NavType = 'url' | 'back' | 'forward' | 'reload';

/**
 * 导航当前页面（纯函数版本）。
 *
 * 支持 URL 导航、前进、后退、刷新操作。
 * 等待 DOMContentLoaded 事件（非完整页面加载）。
 *
 * @param runtime - Navigation 运行时服务
 * @param params - 导航参数 { type?, url?, ignoreCache?, timeout? }
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function navigatePage(
  runtime: NavigationRuntimeServices,
  params: NavigatePageParams,
): Promise<NavigatePageResult> {
  const tooltype = 'navigate_page';
  const navType: NavType = params.type ?? 'url';
  const timeout = params.timeout ?? DEFAULT_NAV_TIMEOUT;
  const options = {timeout, waitUntil: 'domcontentloaded' as const};

  try {
    const page = runtime.getSelectedPage();

    if (navType === 'url' && !params.url) {
      return {
        success: false,
        message: '导航类型为 url 时必须提供 url 参数',
        tooltype,
        logFormat: 'simple',
      };
    }

    switch (navType) {
      case 'url':
        await page.goto(params.url!, options);
        break;
      case 'back':
        await page.goBack(options);
        break;
      case 'forward':
        await page.goForward(options);
        break;
      case 'reload':
        await page.reload({
          ...options,
          ignoreCache: params.ignoreCache,
        });
        break;
    }

    const data: NavigatePageData = {
      type: navType,
      url: page.url(),
      navigated: true,
    };

    const actionLabel: Record<NavType, string> = {
      url: `导航到 ${params.url}`,
      back: '后退导航',
      forward: '前进导航',
      reload: '刷新页面',
    };

    return {
      success: true,
      message: `已${actionLabel[navType]}，当前 URL: ${page.url()}`,
      tooltype,
      logFormat: 'simple',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `导航失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
      logFormat: 'simple',
      data: {
        type: navType,
        url: '',
        navigated: false,
      },
    };
  }
}
