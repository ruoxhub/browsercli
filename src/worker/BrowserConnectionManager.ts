/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrowserConnectionManager — 封装"用最新配置重新连接浏览器"的协调逻辑。
 *
 * 不改动 BrowserManager 内部实现，只调用其 getInstance / resetInstance /
 * ensureBrowser，并通过 ToolContextProvider 更新工具层持有的引用。
 */

import type {BrowserManagerConfig} from '../modules/browser/index.js';
import {BrowserManager} from '../modules/browser/index.js';
import type {ToolContextProvider} from './ToolContext.js';

export interface ConnectResult {
  connected: boolean;
  mode: string;
}

/**
 * 用最新配置连接浏览器（断开旧实例若有）。
 *
 * @param contextProvider 工具上下文提供者，连接后更新其 BrowserManager/Browser/Context 引用
 * @param config 浏览器配置（从 RuntimeConfigStore 读取）
 */
export async function connectBrowser(
  contextProvider: ToolContextProvider,
  config: BrowserManagerConfig,
): Promise<ConnectResult> {
  await BrowserManager.resetInstance();
  const manager = BrowserManager.getInstance(config);
  const browser = await manager.ensureBrowser();
  const context = manager.getContext() ?? browser.contexts()[0] ?? null;

  contextProvider.setBrowserManager(manager);
  contextProvider.setBrowser(browser);
  if (context) {
    contextProvider.setContext(context);
  }
  await contextProvider.init();

  const mode = config.browserURL
    ? 'attach'
    : config.wsEndpoint
      ? 'ws-endpoint'
      : 'launch';

  return {connected: true, mode};
}

/**
 * 断开浏览器连接，清除 contextProvider 中的旧引用。
 */
export async function disconnectBrowser(
  contextProvider: ToolContextProvider,
): Promise<void> {
  await BrowserManager.resetInstance();
  contextProvider.setBrowser(null);
  contextProvider.clearContext();
}
