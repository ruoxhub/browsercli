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
import {workerActivityCoordinator} from './WorkerActivityCoordinator.js';

export interface ConnectResult {
  connected: boolean;
  mode: Exclude<BrowserConnectionMode, 'disconnected'>;
}

export type BrowserConnectionMode =
  | 'attach'
  | 'ws-endpoint'
  | 'launch'
  | 'disconnected';

export interface BrowserConnectionStatus {
  connected: boolean;
  mode: BrowserConnectionMode;
  pages: number;
}

export interface DisconnectBrowserOptions {
  force?: boolean;
}

export function getBrowserConnectionMode(
  config: BrowserManagerConfig,
): Exclude<BrowserConnectionMode, 'disconnected'> {
  if (
    config.wsEndpoint ||
    config.remoteDebuggingUrl?.startsWith('ws://') ||
    config.remoteDebuggingUrl?.startsWith('wss://')
  ) {
    return 'ws-endpoint';
  }
  if (config.browserURL || config.remoteDebuggingUrl) return 'attach';
  return 'launch';
}

export function getBrowserConnectionStatus(
  contextProvider: ToolContextProvider,
  config: BrowserManagerConfig,
): BrowserConnectionStatus {
  try {
    if (!contextProvider.isBrowserConnected()) {
      return {connected: false, mode: 'disconnected', pages: 0};
    }
    return {
      connected: true,
      mode: getBrowserConnectionMode(config),
      pages: contextProvider.getContext()?.pages().length ?? 0,
    };
  } catch {
    return {connected: false, mode: 'disconnected', pages: 0};
  }
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
  options: {maxRetries?: number; initialDelayMs?: number} = {},
): Promise<ConnectResult> {
  const mode = getBrowserConnectionMode(config);
  // remote 模式（连接已存在的外部 Chrome/DevToolsActivePort）每次新连接都会触发 Chrome 弹窗询问，
  // 严禁快速重试风暴导致 Chrome 反复弹窗，默认单次尝试即可。
  const isRemote = mode === 'ws-endpoint' || mode === 'attach';
  const maxRetries = options.maxRetries ?? (isRemote ? 1 : 3);
  const initialDelayMs = options.initialDelayMs ?? 200;

  return await workerActivityCoordinator.runBrowserOperation(
    'connect',
    async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await BrowserManager.resetInstance();
          contextProvider.setBrowser(null);
          contextProvider.clearContext();
          const manager = BrowserManager.getInstance(config);
          const browser = await manager.ensureBrowser();
          const context = manager.getContext() ?? browser.contexts()[0] ?? null;

          contextProvider.setBrowserManager(manager);
          contextProvider.setBrowser(browser);
          if (context) {
            contextProvider.setContext(context);
          } else {
            contextProvider.clearContext();
          }
          await contextProvider.init();

          const mode = getBrowserConnectionMode(config);
          return {connected: true, mode};
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries - 1) {
            const delay = initialDelayMs * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      throw lastError;
    },
  );
}

/**
 * 断开浏览器连接，清除 contextProvider 中的旧引用。
 */
export async function disconnectBrowser(
  contextProvider: ToolContextProvider,
  options: DisconnectBrowserOptions = {},
): Promise<void> {
  const disconnect = async () => {
    await BrowserManager.resetInstance();
    contextProvider.setBrowser(null);
    contextProvider.clearContext();
  };
  await workerActivityCoordinator.runBrowserOperation(
    'disconnect',
    disconnect,
    {allowActiveTools: options.force === true},
  );
}
