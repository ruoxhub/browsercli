/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 页面信息策略模块。提取自 PageController.ts，封装页面信息读取、截图、
 * 视频操作、性能指标、脚本注入、Cookie、视口、Storage、链接收集等操作。
 *
 * @see {@link ./PageController.ts} — 门面，通过委托调用本模块
 */

import fs from 'node:fs';
import path from 'node:path';

import type {Page} from '../../third_party/index.js';

import {logger} from '../../utils/logger.js';

import type {ScreenshotOptions} from './PageControllerTypes.js';

const EMULATED_DEVICES: Record<
  'iPhone' | 'iPad' | 'Android',
  {viewport: {width: number; height: number}; userAgent: string}
> = {
  iPhone: {
    viewport: {width: 375, height: 812},
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
  },
  iPad: {
    viewport: {width: 768, height: 1024},
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
  },
  Android: {
    viewport: {width: 360, height: 640},
    userAgent:
      'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120',
  },
};

/** 获取页面URL（薄封装page.url） */
export async function getURL(page: Page): Promise<string> {
  return page.url();
}

/** 获取页面标题（薄封装page.title） */
export async function getTitle(page: Page): Promise<string> {
  return await page.title();
}

/** 获取页面HTML内容（薄封装page.content） */
export async function getContent(page: Page): Promise<string> {
  return await page.content();
}

/**
 * 截图（薄封装page.screenshot）
 */
export async function screenshot(
  page: Page,
  options?: ScreenshotOptions,
): Promise<Buffer> {
  // 🆕 自动创建截图目录
  if (options?.path) {
    const dir = path.dirname(options.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {recursive: true});
      logger.debug(`Screenshot directory created: ${dir}`);
    }
  }

  const buffer = await page.screenshot({
    path: options?.path,
    type: options?.type || 'png',
    quality: options?.quality,
    fullPage: options?.fullPage || false,
  });
  logger.info(`Screenshot taken${options?.path ? `: ${options.path}` : ''}`);
  return buffer as Buffer;
}

/**
 * 执行JavaScript代码（薄封装page.evaluate）
 */
export async function evaluate<T>(page: Page, code: string): Promise<T> {
  const result = await page.evaluate(code);
  logger.info('JavaScript executed');
  return result as T;
}

/**
 * 🆕 获取视频元素信息
 */
export async function getVideoInfo(
  page: Page,
  selector: string,
): Promise<{
  duration: number;
  currentTime: number;
  paused: boolean;
  src: string;
} | null> {
  return await page.evaluate(sel => {
    const video = document.querySelector(sel) as HTMLVideoElement;
    if (!video) return null;
    return {
      duration: video.duration,
      currentTime: video.currentTime,
      paused: video.paused,
      src: video.src,
    };
  }, selector);
}

/**
 * 🆕 定位视频到指定时间点
 */
export async function seekVideo(
  page: Page,
  selector: string,
  time: number,
): Promise<void> {
  await page.evaluate(
    ({sel, t}: {sel: string; t: number}) => {
      const video = document.querySelector(sel) as HTMLVideoElement;
      if (video) {
        video.currentTime = t;
      }
    },
    {sel: selector, t: time},
  );
  logger.info(`Video seeked to ${time}s: ${selector}`);
}

/**
 * 🆕 捕获视频当前帧（先 seek 到指定时间，然后截图）
 */
export async function captureVideoFrame(
  page: Page,
  selector: string,
  options?: {
    seekTime?: number;
    outputPath?: string;
    format?: 'png' | 'jpeg';
    quality?: number;
  },
): Promise<Buffer | string> {
  // 先定位到指定时间点
  if (options?.seekTime !== undefined) {
    await seekVideo(page, selector, options.seekTime);
    // 等待 seek 完成
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // 获取视频帧的边界框
  const videoBox = await page.evaluate(sel => {
    const video = document.querySelector(sel) as HTMLVideoElement;
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      tagName: video.tagName,
    };
  }, selector);

  if (!videoBox) {
    throw new Error(`Video element not found: ${selector}`);
  }

  // 截图
  const buffer = await page.screenshot({
    path: options?.outputPath,
    type: options?.format || 'png',
    quality: options?.quality,
    clip: {
      x: Math.round(videoBox.x),
      y: Math.round(videoBox.y),
      width: Math.round(videoBox.width),
      height: Math.round(videoBox.height),
    },
  });

  logger.info(
    `Video frame captured${options?.outputPath ? `: ${options.outputPath}` : ''}`,
  );
  return options?.outputPath ? options.outputPath : (buffer as Buffer);
}

/**
 * 🆕 获取页面性能指标
 */
export async function getPerformanceMetrics(page: Page): Promise<any> {
  const metrics = await page.evaluate(() => {
    const perf = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming;

    const result: Record<string, unknown> = {
      // 页面加载时间
      domContentLoaded:
        perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
      loadComplete: perf.loadEventEnd - perf.loadEventStart,

      // 网络时间
      dns: perf.domainLookupEnd - perf.domainLookupStart,
      tcp: perf.connectEnd - perf.connectStart,
      request: perf.responseStart - perf.requestStart,
      response: perf.responseEnd - perf.responseStart,

      // 总时间
      total: perf.loadEventEnd - perf.fetchStart,

      // 资源统计
      resources: performance.getEntriesByType('resource').length,
    };

    // Paint Timing
    const paintEntries = performance.getEntriesByType('paint');
    const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
    if (fcp) {
      result.firstContentfulPaint = fcp.startTime;
    }

    // Largest Contentful Paint
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
    if (lcpEntries.length > 0) {
      result.largestContentfulPaint =
        lcpEntries[lcpEntries.length - 1].startTime;
    }

    // Cumulative Layout Shift
    const clsEntries = performance.getEntriesByType('layout-shift') as Array<
      PerformanceEntry & {value: number; hadRecentInput: boolean}
    >;
    if (clsEntries.length > 0) {
      let clsValue = 0;
      for (const entry of clsEntries) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      }
      result.cumulativeLayoutShift = clsValue;
    }

    return result;
  });

  logger.info('Performance metrics retrieved');
  return metrics;
}

/**
 * 🆕 注入JavaScript代码到页面
 */
export async function injectScript(
  page: Page,
  scriptContent: string,
): Promise<void> {
  await page.evaluate(script => {
    const scriptElement = document.createElement('script');
    scriptElement.textContent = script;
    document.head.appendChild(scriptElement);
  }, scriptContent);

  logger.info('Script injected into page');
}

/**
 * 在后续文档创建前注入脚本
 */
export async function injectScriptOnNewDocument(
  page: Page,
  scriptContent: string,
): Promise<void> {
  // Playwright: addInitScript replaces evaluateOnNewDocument
  await page.addInitScript(script => {
    // Run script directly in the new document context.
    // This avoids relying on DOM readiness (head/body may not exist yet)
    // and is more reliable than appending an inline <script> element.

    new Function(script)();
  }, scriptContent);

  logger.info('Preload script registered for future documents');
}

/**
 * 🆕 设置Cookie
 * Playwright: page.setCookie → page.context().addCookies()
 */
export async function setCookies(
  page: Page,
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>,
): Promise<void> {
  await page.context().addCookies(cookies);
  logger.info(`Set ${cookies.length} cookies`);
}

/**
 * 🆕 获取Cookie
 * Playwright: page.cookies() → page.context().cookies()
 */
export async function getCookies(page: Page): Promise<any[]> {
  const cookies = await page.context().cookies();
  logger.info(`Retrieved ${cookies.length} cookies`);
  return cookies;
}

/**
 * 🆕 清除Cookie
 * Playwright: page.deleteCookie → page.context().clearCookies()
 */
export async function clearCookies(page: Page): Promise<void> {
  await page.context().clearCookies();
  logger.info('All cookies cleared');
}

/**
 * 🆕 设置视口大小
 * Playwright: page.setViewport() → page.setViewportSize()
 */
export async function setViewport(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({width, height});
  logger.info(`Viewport set to ${width}x${height}`);
}

/**
 * 🆕 模拟设备
 * Playwright: setUserAgent via CDP, setViewport via setViewportSize
 */
export async function emulateDevice(
  page: Page,
  deviceName: 'iPhone' | 'iPad' | 'Android',
): Promise<void> {
  const device = EMULATED_DEVICES[deviceName];
  await page.setViewportSize(device.viewport);

  // Playwright: setUserAgent via CDP
  const client = await page.context().newCDPSession(page);
  await client.send('Network.setUserAgentOverride', {
    userAgent: device.userAgent,
  });

  logger.info(`Emulating ${deviceName}`);
}

/** 🆕 获取LocalStorage */
export async function getLocalStorage(
  page: Page,
): Promise<Record<string, string>> {
  try {
    const storage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          items[key] = localStorage.getItem(key) || '';
        }
      }
      return items;
    });

    logger.info(`Retrieved ${Object.keys(storage).length} localStorage items`);
    return storage;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('SecurityError') || msg.includes('Access is denied')) {
      logger.warn(`localStorage access denied on current page: ${msg}`);
      return {};
    }
    throw error;
  }
}

/** 🆕 设置LocalStorage */
export async function setLocalStorage(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ({k, v}: {k: string; v: string}) => {
      localStorage.setItem(k, v);
    },
    {k: key, v: value},
  );

  logger.info(`Set localStorage: ${key}`);
}

/** 🆕 清除LocalStorage */
export async function clearLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
  });

  logger.info('LocalStorage cleared');
}

/** 获取SessionStorage */
export async function getSessionStorage(
  page: Page,
): Promise<Record<string, string>> {
  try {
    const storage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          items[key] = sessionStorage.getItem(key) || '';
        }
      }
      return items;
    });
    logger.info(
      `Retrieved ${Object.keys(storage).length} sessionStorage items`,
    );
    return storage;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('SecurityError') || msg.includes('Access is denied')) {
      logger.warn(`sessionStorage access denied on current page: ${msg}`);
      return {};
    }
    throw error;
  }
}

/**
 * 设置SessionStorage
 */
export async function setSessionStorage(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ({k, v}: {k: string; v: string}) => {
      sessionStorage.setItem(k, v);
    },
    {k: key, v: value},
  );
  logger.info(`Set sessionStorage: ${key}`);
}

/**
 * 清除SessionStorage
 */
export async function clearSessionStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    sessionStorage.clear();
  });
  logger.info('SessionStorage cleared');
}

/**
 * 🆕 获取页面所有链接
 */
export async function getAllLinks(
  page: Page,
): Promise<Array<{text: string; href: string}>> {
  const links = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href]');
    const result: Array<{text: string; href: string}> = [];

    for (const anchor of Array.from(anchors) as HTMLAnchorElement[]) {
      result.push({
        text: anchor.textContent?.trim() || '',
        href: anchor.href,
      });
    }

    return result;
  });

  logger.info(`Found ${links.length} links`);
  return links;
}
