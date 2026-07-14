/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 页面交互策略模块。提取自 PageController.ts，封装元素点击、输入、滚动等操作。
 *
 * @see {@link ./PageController.ts} — 门面，通过委托调用本模块
 */

import type {Page} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

import type {
  ClickOptions,
  ScrollOptions,
  TypeOptions,
} from './PageControllerTypes.js';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;

/**
 * 点击元素（薄封装page.click）
 */
export async function click(
  page: Page,
  selector: string,
  options?: ClickOptions,
): Promise<void> {
  await page.click(selector, {
    button: options?.button || 'left',
    clickCount: options?.clickCount || 1,
    delay: options?.delay,
  });
  logger.info(`Clicked: ${selector}`);
}

/**
 * 🆕 真实鼠标点击 — CDP Input.dispatchMouseEvent
 * 算作用户真实手势，能触发文件对话框、绕过部分反自动化检测
 */
export async function clickAt(
  page: Page,
  selector: string,
): Promise<{
  x: number;
  y: number;
  tag: string;
  text: string;
}> {
  const client = await page.context().newCDPSession(page);

  // 获取元素坐标
  const coords = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.scrollIntoView({block: 'center'});
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      tag: el.tagName,
      text: (el.textContent || '').slice(0, 100),
    };
  }, selector);

  // 发送真实鼠标按下事件
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: coords.x,
    y: coords.y,
    button: 'left',
    clickCount: 1,
  });

  // 发送真实鼠标释放事件
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: coords.x,
    y: coords.y,
    button: 'left',
    clickCount: 1,
  });

  logger.info(`Real mouse click at: ${selector} (${coords.x}, ${coords.y})`);
  return coords;
}

/**
 * 🆕 文件上传绕过对话框 — CDP DOM.setFileInputFiles
 * 直接设置 file input 的本地文件路径，完全绕过文件对话框
 */
export async function setFiles(
  page: Page,
  selector: string,
  filePaths: string[],
): Promise<{
  success: boolean;
  files: number;
}> {
  const client = await page.context().newCDPSession(page);

  // 启用 DOM 域
  await client.send('DOM.enable', {});

  // 获取文档根节点
  const doc = await client.send('DOM.getDocument', {});

  // 查找目标元素
  const node = await client.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector,
  });

  if (!node.nodeId) {
    throw new Error(`Element not found: ${selector}`);
  }

  // 设置文件
  await client.send('DOM.setFileInputFiles', {
    nodeId: node.nodeId,
    files: filePaths,
  });

  logger.info(`Set ${filePaths.length} file(s) to ${selector}`);
  return {success: true, files: filePaths.length};
}

/**
 * 输入文本（薄封装page.type）
 */
export async function type(
  page: Page,
  selector: string,
  text: string,
  options?: TypeOptions,
): Promise<void> {
  await page.type(selector, text, {
    delay: options?.delay,
  });
  logger.info(`Typed into ${selector}: ${text.substring(0, 20)}...`);
}

/**
 * 选择下拉框选项（薄封装page.selectOption）
 * Playwright: page.select() → page.selectOption()
 */
export async function select(
  page: Page,
  selector: string,
  ...values: string[]
): Promise<void> {
  await page.selectOption(selector, values);
  logger.info(`Selected in ${selector}: ${values.join(', ')}`);
}

/**
 * 鼠标悬停（薄封装page.hover）
 */
export async function hover(page: Page, selector: string): Promise<void> {
  await page.hover(selector);
  logger.info(`Hovered: ${selector}`);
}

/**
 * 滚动页面（薄封装page.evaluate）
 */
export async function scroll(
  page: Page,
  options: ScrollOptions,
): Promise<void> {
  await page.evaluate(opts => {
    window.scrollTo(opts.x || 0, opts.y || 0);
  }, options);
  logger.info(`Scrolled to: x=${options.x || 0}, y=${options.y || 0}`);
}

/**
 * 🆕 方向滚动（支持懒加载触发）
 * @param direction 'up' | 'down' | 'top' | 'bottom'
 * @param pixels 滚动像素（仅用于 up/down）
 */
export async function scrollBy(
  page: Page,
  direction: 'up' | 'down' | 'top' | 'bottom',
  pixels = 1000,
): Promise<string> {
  const result = await page.evaluate(
    ({dir, px}: {dir: string; px: number}) => {
      switch (dir) {
        case 'top':
          window.scrollTo(0, 0);
          return 'scrolled to top';
        case 'bottom':
          window.scrollTo(0, document.body.scrollHeight);
          return 'scrolled to bottom';
        case 'up':
          window.scrollBy(0, -Math.abs(px));
          return `scrolled up ${Math.abs(px)}px`;
        case 'down':
          window.scrollBy(0, Math.abs(px));
          return `scrolled down ${Math.abs(px)}px`;
      }
    },
    {dir: direction, px: pixels},
  );

  // 等待懒加载触发（800ms 与 web-access 一致）
  await new Promise(resolve => setTimeout(resolve, 800));

  logger.info(`Scrolled ${direction}: ${result}`);
  return result;
}

/**
 * 等待选择器出现并返回元素信息（增强版）
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout?: number,
): Promise<{
  success: boolean;
  element?: any;
  message: string;
}> {
  try {
    await page.waitForSelector(selector, {
      timeout: timeout || DEFAULT_NAVIGATION_TIMEOUT_MS,
    });

    const element = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return null;

      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: el.className || undefined,
        textContent: el.textContent?.trim().substring(0, 100) || undefined,
        attributes: Array.from(el.attributes).reduce(
          (acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          },
          {} as Record<string, string>,
        ),
      };
    }, selector);

    logger.info(`Selector appeared: ${selector}`);

    return {
      success: true,
      element,
      message: `Selector appeared: ${selector}`,
    };
  } catch (error: any) {
    logger.error(`waitForSelector timeout for ${selector}:`, error);
    return {
      success: false,
      message: `Timeout waiting for selector: ${selector}`,
    };
  }
}

/**
 * 🆕 模拟键盘按键
 */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key as any);
  logger.info(`Pressed key: ${key}`);
}

/**
 * 🆕 上传文件
 * Playwright: element.uploadFile() → element.setInputFiles()
 */
export async function uploadFile(
  page: Page,
  selector: string,
  filePath: string,
): Promise<void> {
  const input = await page.$(selector);

  if (!input) {
    throw new Error(`File input not found: ${selector}`);
  }

  await input.setInputFiles(filePath);
  logger.info(`File uploaded: ${filePath}`);
}
