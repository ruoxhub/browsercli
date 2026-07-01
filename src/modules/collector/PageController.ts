/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 页面操作控制器。薄门面，将 43 个公共方法委托到 PageNavigation /
 * PageInteraction / PageInfo 三个策略模块。公共 API 与原版完全兼容。
 *
 * @see {@link src/modules/collector/CodeCollector.ts} — 脚本收集依赖页面状态
 * @see {@link src/modules/collector/DOMInspector.ts} — DOM 检查依赖 CodeCollector
 * @see {@link src/runtime.ts} — getRuntime() 创建 PageController
 */

import type {Page} from '../../third_party/index.js';

import type {CodeCollector} from './CodeCollector.js';
import * as PageInfo from './PageInfo.js';
import * as PageInteraction from './PageInteraction.js';
import * as PageNavigation from './PageNavigation.js';
import type {
  ClickOptions,
  NavigationOptions,
  ReplayAction,
  ScreenshotOptions,
  ScrollOptions,
  TypeOptions,
} from './PageControllerTypes.js';

export * from './PageControllerTypes.js';

export class PageController {
  constructor(private collector: CodeCollector) {}

  async navigate(url: string, options?: NavigationOptions): Promise<{url: string; title: string; loadTime: number}> {
    const page = await this.collector.getActivePage();
    return PageNavigation.navigate(page, url, options);
  }

  async reload(options?: NavigationOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageNavigation.reload(page, options);
  }

  async goBack(): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageNavigation.goBack(page);
  }

  async goForward(): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageNavigation.goForward(page);
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.click(page, selector, options);
  }

  async clickAt(selector: string): Promise<{x: number; y: number; tag: string; text: string}> {
    const page = await this.collector.getActivePage();
    return PageInteraction.clickAt(page, selector);
  }

  async setFiles(selector: string, filePaths: string[]): Promise<{success: boolean; files: number}> {
    const page = await this.collector.getActivePage();
    return PageInteraction.setFiles(page, selector, filePaths);
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.type(page, selector, text, options);
  }

  async select(selector: string, ...values: string[]): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.select(page, selector, ...values);
  }

  async hover(selector: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.hover(page, selector);
  }

  async scroll(options: ScrollOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.scroll(page, options);
  }

  async scrollBy(direction: 'up' | 'down' | 'top' | 'bottom', pixels = 1000): Promise<string> {
    const page = await this.collector.getActivePage();
    return PageInteraction.scrollBy(page, direction, pixels);
  }

  async waitForSelector(selector: string, timeout?: number): Promise<{success: boolean; element?: any; message: string}> {
    const page = await this.collector.getActivePage();
    return PageInteraction.waitForSelector(page, selector, timeout);
  }

  async waitForNavigation(timeout?: number): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageNavigation.waitForNavigation(page, timeout);
  }

  async evaluate<T>(code: string): Promise<T> {
    const page = await this.collector.getActivePage();
    return PageInfo.evaluate<T>(page, code);
  }

  async getURL(): Promise<string> {
    const page = await this.collector.getActivePage();
    return PageInfo.getURL(page);
  }

  async getTitle(): Promise<string> {
    const page = await this.collector.getActivePage();
    return PageInfo.getTitle(page);
  }

  async getContent(): Promise<string> {
    const page = await this.collector.getActivePage();
    return PageInfo.getContent(page);
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const page = await this.collector.getActivePage();
    return PageInfo.screenshot(page, options);
  }

  async getVideoInfo(selector: string): Promise<{duration: number; currentTime: number; paused: boolean; src: string} | null> {
    const page = await this.collector.getActivePage();
    return PageInfo.getVideoInfo(page, selector);
  }

  async seekVideo(selector: string, time: number): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.seekVideo(page, selector, time);
  }

  async captureVideoFrame(
    selector: string,
    options?: {seekTime?: number; outputPath?: string; format?: 'png' | 'jpeg'; quality?: number},
  ): Promise<Buffer | string> {
    const page = await this.collector.getActivePage();
    return PageInfo.captureVideoFrame(page, selector, options);
  }

  async getPerformanceMetrics(): Promise<any> {
    const page = await this.collector.getActivePage();
    return PageInfo.getPerformanceMetrics(page);
  }

  async injectScript(scriptContent: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.injectScript(page, scriptContent);
  }

  async injectScriptOnNewDocument(scriptContent: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.injectScriptOnNewDocument(page, scriptContent);
  }

  async setCookies(cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.setCookies(page, cookies);
  }

  async getCookies(): Promise<any[]> {
    const page = await this.collector.getActivePage();
    return PageInfo.getCookies(page);
  }

  async clearCookies(): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.clearCookies(page);
  }

  async setViewport(width: number, height: number): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.setViewport(page, width, height);
  }

  async emulateDevice(deviceName: 'iPhone' | 'iPad' | 'Android'): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.emulateDevice(page, deviceName);
  }

  async waitForNetworkIdle(timeout = 30000): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageNavigation.waitForNetworkIdle(page, timeout);
  }

  async getLocalStorage(): Promise<Record<string, string>> {
    const page = await this.collector.getActivePage();
    return PageInfo.getLocalStorage(page);
  }

  async setLocalStorage(key: string, value: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.setLocalStorage(page, key, value);
  }

  async clearLocalStorage(): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.clearLocalStorage(page);
  }

  async getSessionStorage(): Promise<Record<string, string>> {
    const page = await this.collector.getActivePage();
    return PageInfo.getSessionStorage(page);
  }

  async setSessionStorage(key: string, value: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.setSessionStorage(page, key, value);
  }

  async clearSessionStorage(): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInfo.clearSessionStorage(page);
  }

  async pressKey(key: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.pressKey(page, key);
  }

  async uploadFile(selector: string, filePath: string): Promise<void> {
    const page = await this.collector.getActivePage();
    return PageInteraction.uploadFile(page, selector, filePath);
  }

  async getAllLinks(): Promise<Array<{text: string; href: string}>> {
    const page = await this.collector.getActivePage();
    return PageInfo.getAllLinks(page);
  }

  async getPage(): Promise<Page> {
    return await this.collector.getActivePage();
  }

  async replayActions(actions: ReplayAction[]): Promise<Array<{index: number; action: string; success: boolean; message: string}>> {
    const results: Array<{index: number; action: string; success: boolean; message: string}> = [];
    for (let index = 0; index < actions.length; index += 1) {
      const item = actions[index];
      try {
        switch (item.action) {
          case 'navigate':
            if (!item.url) throw new Error('navigate action requires url');
            await this.navigate(item.url, {timeout: item.timeout});
            break;
          case 'click':
            if (!item.selector) throw new Error('click action requires selector');
            await this.click(item.selector);
            break;
          case 'type':
            if (!item.selector) throw new Error('type action requires selector');
            await this.type(item.selector, item.text ?? '', {delay: item.delay});
            break;
          case 'wait':
            if (!item.selector) throw new Error('wait action requires selector');
            await this.waitForSelector(item.selector, item.timeout);
            break;
          case 'scroll':
            await this.scroll({x: item.x, y: item.y});
            break;
          case 'pressKey':
            if (!item.key) throw new Error('pressKey action requires key');
            await this.pressKey(item.key);
            break;
          case 'evaluate':
            if (!item.code) throw new Error('evaluate action requires code');
            await this.evaluate(item.code);
            break;
          default:
            throw new Error(`Unsupported action: ${(item as {action?: string}).action ?? 'unknown'}`);
        }
        results.push({index, action: item.action, success: true, message: 'ok'});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({index, action: item.action, success: false, message});
      }
    }
    return results;
  }
}
