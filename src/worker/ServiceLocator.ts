/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BrowserManager} from '../modules/browser/index.js';
import {CodeCollector} from '../modules/collector/CodeCollector.js';
import {PageController} from '../modules/collector/PageController.js';
import {HookManager} from '../modules/hook/HookManager.js';
import type {Runtime} from '../runtime.js';

export class ServiceLocator {
  private _runtime: Runtime | null = null;

  private _browserManager: BrowserManager | null = null;
  private _collector: CodeCollector | null = null;
  private _hookManager: HookManager | null = null;
  private _pageController: PageController | null = null;

  constructor(runtime?: Runtime) {
    if (runtime) {
      this._runtime = runtime;
      this._browserManager = runtime.browserManager;
      this._collector = runtime.collector;
    }
  }

  setBrowserManager(browserManager: BrowserManager): void {
    this._browserManager = browserManager;
  }

  getBrowserManager(): BrowserManager | null {
    return this._browserManager;
  }

  private getOrCreate<T>(
    cached: T | null,
    runtimeKey: keyof Runtime,
    factory: () => T,
  ): T {
    const fromRuntime = this._runtime?.[runtimeKey] as T | undefined;
    if (fromRuntime) return fromRuntime;
    return cached ?? factory();
  }

  getCollector(): CodeCollector {
    if (this._collector) return this._collector;
    if (!this._browserManager) {
      throw new Error(
        'BrowserManager 未初始化，无法创建 CodeCollector。请先调用 setBrowserManager()。',
      );
    }
    const config = {
      timeout: 30000,
      maxCollectedUrls: 10000,
      maxFilesPerCollect: 200,
      maxTotalContentSize: 512 * 1024,
      maxSingleFileSize: 200 * 1024,
    };
    this._collector = new CodeCollector(config, this._browserManager);
    return this._collector;
  }

  getHookManager(): HookManager {
    return this.getOrCreate(this._hookManager, 'hookManager', () => {
      this._hookManager = new HookManager();
      return this._hookManager;
    });
  }

  getPageController(): PageController {
    return this.getOrCreate(this._pageController, 'pageController', () => {
      this._pageController = new PageController(this.getCollector());
      return this._pageController;
    });
  }
}
