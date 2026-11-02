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

export interface ConnectBrowserOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  force?: boolean;
}

export interface DisconnectBrowserOptions {
  force?: boolean;
}

let inFlightConnectPromise: Promise<ConnectResult> | null = null;
let inFlightConnectTarget: BrowserManagerConfig | null = null;

/**
 * 获取当前正在执行中的浏览器连接目标配置（若有）。
 */
export function getInFlightBrowserConnectTarget(): BrowserManagerConfig | null {
  return inFlightConnectTarget;
}

/**
 * 连接方式判定。
 */
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
  if (config.browserURL || config.remoteDebuggingUrl || config.autoConnect) {
    return 'attach';
  }
  return 'launch';
}

export function isSameBrowserTarget(
  a: BrowserManagerConfig,
  b: BrowserManagerConfig,
): boolean {
  if (getBrowserConnectionMode(a) !== getBrowserConnectionMode(b)) {
    return false;
  }
  const mode = getBrowserConnectionMode(a);
  if (mode === 'ws-endpoint') {
    return (
      (a.wsEndpoint ?? '') === (b.wsEndpoint ?? '') &&
      (a.remoteDebuggingUrl ?? '') === (b.remoteDebuggingUrl ?? '')
    );
  }
  if (mode === 'attach') {
    return (
      (a.browserURL ?? '') === (b.browserURL ?? '') &&
      (a.remoteDebuggingUrl ?? '') === (b.remoteDebuggingUrl ?? '') &&
      a.remoteDebuggingPort === b.remoteDebuggingPort &&
      Boolean(a.autoConnect) === Boolean(b.autoConnect) &&
      (a.userDataDir ?? '') === (b.userDataDir ?? '')
    );
  }
  return (
    a.channel === b.channel &&
    (a.executablePath ?? '') === (b.executablePath ?? '') &&
    (a.browserPath ?? '') === (b.browserPath ?? '') &&
    (a.userDataDir ?? '') === (b.userDataDir ?? '') &&
    Boolean(a.headless) === Boolean(b.headless) &&
    Boolean(a.isolated) === Boolean(b.isolated) &&
    Boolean(a.cloak) === Boolean(b.cloak)
  );
}

export function getBrowserConnectionStatus(
  contextProvider: ToolContextProvider,
  config: BrowserManagerConfig,
): BrowserConnectionStatus {
  try {
    if (!contextProvider.isBrowserConnected()) {
      return {connected: false, mode: 'disconnected', pages: 0};
    }
    const activeConfig =
      contextProvider.getBrowserManager?.()?.getConfig?.() ?? config;
    return {
      connected: true,
      mode: getBrowserConnectionMode(activeConfig),
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
  options: ConnectBrowserOptions = {},
): Promise<ConnectResult> {
  const mode = getBrowserConnectionMode(config);

  // 幂等复用保护：若当前连接健康且未要求强制重连，且请求的目标配置与当前活跃连接一致，
  // 直接复用已有会话，避免主动 resetInstance() 掐断 WebSocket 导致 Chrome 反复弹出远程调试安全授权确认框。
  if (!options.force) {
    if (contextProvider.isBrowserConnected?.()) {
      const existingBrowser = contextProvider.getBrowser?.();
      if (
        existingBrowser &&
        (typeof existingBrowser.isConnected !== 'function' ||
          existingBrowser.isConnected())
      ) {
        const activeConfig = contextProvider
          .getBrowserManager?.()
          ?.getConfig?.();
        if (!activeConfig || isSameBrowserTarget(activeConfig, config)) {
          return {
            connected: true,
            mode: getBrowserConnectionMode(activeConfig ?? config),
          };
        }
      }
    }

    // 并发去重：若当前已有针对相同目标的连接正在执行中，直接共享并等待该 Promise，避免并发锁竞争产生 WORKER_BUSY
    if (
      inFlightConnectPromise &&
      inFlightConnectTarget &&
      isSameBrowserTarget(inFlightConnectTarget, config)
    ) {
      return await inFlightConnectPromise;
    }
  }

  // remote 模式（连接已存在的外部 Chrome/DevToolsActivePort）每次新连接都会触发 Chrome 弹窗询问，
  // 严禁快速重试风暴导致 Chrome 反复弹窗，默认单次尝试即可。
  const isRemote = mode === 'ws-endpoint' || mode === 'attach';
  const maxRetries = options.maxRetries ?? (isRemote ? 1 : 3);
  const initialDelayMs = options.initialDelayMs ?? 200;

  const connectPromise = (async () => {
    try {
      return await workerActivityCoordinator.runBrowserOperation(
        'connect',
        async () => {
          let lastError: unknown;
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              if ((await BrowserManager.resetInstance()) === false) {
                throw new Error(
                  'Failed to tear down the previous browser before reconnecting',
                );
              }
              contextProvider.setBrowser(null);
              contextProvider.clearContext();
              const manager = BrowserManager.getInstance(config);
              const browser = await manager.ensureBrowser();
              const context =
                manager.getContext() ?? browser.contexts()[0] ?? null;

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
    } finally {
      if (inFlightConnectPromise === connectPromise) {
        inFlightConnectPromise = null;
        inFlightConnectTarget = null;
      }
    }
  })();

  inFlightConnectPromise = connectPromise;
  inFlightConnectTarget = config;
  return await connectPromise;
}

/**
 * 断开浏览器连接，清除 contextProvider 中的旧引用。
 */
export async function disconnectBrowser(
  contextProvider: ToolContextProvider,
  options: DisconnectBrowserOptions = {},
): Promise<void> {
  const disconnect = async () => {
    inFlightConnectPromise = null;
    inFlightConnectTarget = null;
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
