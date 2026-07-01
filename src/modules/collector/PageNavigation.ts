/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 页面导航策略模块。提取自 PageController.ts，封装导航相关 Playwright 操作。
 *
 * @see {@link ./PageController.ts} — 门面，通过委托调用本模块
 */

import type {Page} from '../../third_party/index.js';

import {logger} from '../../utils/logger.js';

import type {NavigationOptions} from './PageControllerTypes.js';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;

/**
 * 导航到指定URL（薄封装page.goto）
 */
export async function navigate(
  page: Page,
  url: string,
  options?: NavigationOptions,
): Promise<{
  url: string;
  title: string;
  loadTime: number;
}> {
  const startTime = Date.now();

  await page.goto(url, {
    waitUntil: options?.waitUntil || 'networkidle',
    timeout: options?.timeout || DEFAULT_NAVIGATION_TIMEOUT_MS,
  });

  const loadTime = Date.now() - startTime;
  const title = await page.title();
  const currentUrl = page.url();

  logger.info(`Navigated to: ${url}`);

  return {
    url: currentUrl,
    title,
    loadTime,
  };
}

/**
 * 重新加载页面（薄封装page.reload）
 */
export async function reload(
  page: Page,
  options?: NavigationOptions,
): Promise<void> {
  await page.reload({
    waitUntil: options?.waitUntil || 'networkidle',
    timeout: options?.timeout || DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
  logger.info('Page reloaded');
}

/**
 * 后退（薄封装page.goBack）
 */
export async function goBack(page: Page): Promise<void> {
  await page.goBack();
  logger.info('Navigated back');
}

/**
 * 前进（薄封装page.goForward）
 */
export async function goForward(page: Page): Promise<void> {
  await page.goForward();
  logger.info('Navigated forward');
}

/**
 * 等待导航完成（薄封装page.waitForNavigation）
 */
export async function waitForNavigation(
  page: Page,
  timeout?: number,
): Promise<void> {
  await page.waitForNavigation({
    waitUntil: 'networkidle',
    timeout: timeout || DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
  logger.info('Navigation completed');
}

/**
 * 🆕 等待网络空闲
 */
export async function waitForNetworkIdle(
  page: Page,
  timeout: number = DEFAULT_NAVIGATION_TIMEOUT_MS,
): Promise<void> {
  // Playwright: use waitForURL with networkidle instead of waitForNetworkIdle
  await page.waitForURL('**', {waitUntil: 'networkidle', timeout});
  logger.info('Network is idle');
}
