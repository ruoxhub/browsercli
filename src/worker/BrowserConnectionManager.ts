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
  | 'ego'
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

/**
 * 连接方式判定。
 *
 * `ego` 必须最先判断：`BrowserManager.connectEgoBrowser()` 会把桥接发布的 ws 端点
 * 写进 `config.wsEndpoint`，所以活跃的 ego 配置看起来就是一个 ws-endpoint 配置。
 * 按 `wsEndpoint` 判定会让同一个 ego 目标在"连接前/连接后"读到不同 mode
 * （入参 `launch` vs 活跃 `ws-endpoint`），从而每次都误判为换了目标。
 */
export function getBrowserConnectionMode(
  config: BrowserManagerConfig,
): Exclude<BrowserConnectionMode, 'disconnected'> {
  if (config.ego) return 'ego';
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

export function isSameBrowserTarget(
  a: BrowserManagerConfig,
  b: BrowserManagerConfig,
): boolean {
  if (getBrowserConnectionMode(a) !== getBrowserConnectionMode(b)) {
    return false;
  }
  const mode = getBrowserConnectionMode(a);
  if (mode === 'ego') {
    // 故意不比较 `wsEndpoint`：ego 的端点是 `start()` 之后才发现并回写进 config
    // 的，入参与活跃配置天然不对称，拿它比较必然失败（→ resetInstance → 毁掉
    // 任务空间）。ego 目标身份 = "ego 开关 + 工作区"，而工作区由
    // `EgoBridgeManager` 用自身 cwd 派生的任务空间名固定，同一进程内的 ego 配置
    // 因此天然是同一个工作区；`cloak`/`channel` 之类对 ego 无意义（不会本地启动），
    // 不参与比较。
    //
    // `keepPage` 必须比较：它被烘进运行中桥接的启动 bootstrap，改不了。两个只差
    // 它的 ego 配置若比较相等，`connectBrowser()` 会短路返回 connected:true，
    // `EgoBridgeManager.start()` 自己的 assertSameOptions() 冲突检查永远到不了，
    // 用户的 `--keep-page` 被静默吞掉（Ruling K）。
    //
    // `egoProfile` 同理，而且更隐蔽：它只在**新建**任务空间时被消费，所以在
    // 已有 live 桥接时换 profile 本就是"改不了"的；这里若判成同一目标，
    // `--profile B` 会静默沿用 A，连 worker 里那条"profile 被忽略"的诊断都不会
    // 打印。空串按「未指定」处理，与 `isProfileWithoutEgo` 的语义一致。
    return (
      (a.keepPage === true) === (b.keepPage === true) &&
      (a.egoProfile?.trim() ?? '') === (b.egoProfile?.trim() ?? '')
    );
  }
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
      a.remoteDebuggingPort === b.remoteDebuggingPort
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
  if (!options.force && contextProvider.isBrowserConnected?.()) {
    const existingBrowser = contextProvider.getBrowser?.();
    if (
      existingBrowser &&
      (typeof existingBrowser.isConnected !== 'function' ||
        existingBrowser.isConnected())
    ) {
      const activeConfig = contextProvider.getBrowserManager?.()?.getConfig?.();
      if (!activeConfig || isSameBrowserTarget(activeConfig, config)) {
        return {
          connected: true,
          mode: getBrowserConnectionMode(activeConfig ?? config),
        };
      }
    }
  }

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
          // A `false` here means the old instance could not be torn down and was
          // deliberately kept (it still owns e.g. an ego bridge). Continuing would
          // silently reconnect on top of it, because `getInstance()` returns the
          // survivor; fail this attempt instead so the retry re-enters
          // `resetInstance()` and retries the teardown.
          if ((await BrowserManager.resetInstance()) === false) {
            throw new Error(
              'Failed to tear down the previous browser before reconnecting',
            );
          }
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
    // `false` means close() failed and the instance (with its bridge) was kept so
    // a later call can retry. Reporting a clean disconnect over a bridge that is
    // still listening would throw away the honesty `stop()` was built for.
    const cleared = await BrowserManager.resetInstance();
    if (cleared === false) {
      throw Object.assign(
        new Error(
          'browser disconnect incomplete: the bridge could not be stopped and was kept for retry',
        ),
        {code: 'BROWSER_DISCONNECT_INCOMPLETE'},
      );
    }
    contextProvider.setBrowser(null);
    contextProvider.clearContext();
  };
  await workerActivityCoordinator.runBrowserOperation(
    'disconnect',
    disconnect,
    {allowActiveTools: options.force === true},
  );
}
