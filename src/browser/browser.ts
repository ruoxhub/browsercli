/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  chromium,
  firefox,
  type Browser,
  type BrowserContext,
  type Page,
} from 'patchright';

import {
  StealthScripts2025,
  type StealthPreset,
  type StealthInjectionOptions,
} from '../modules/stealth/index.js';
import {logger} from '../utils/logger.js';

import {resolveAutoConnectTarget, readDevToolsActivePort} from './browser-discovery.js';
import {
  detectAllBrowsers,
  launchBrowserProcess as spawnBrowserProcess,
  waitForBrowserReady,
} from './browser-detect.js';
import {
  resolveEngine,
  resolveLaunchChannel,
  resolveUserDataDir,
  ensureUserDataDir,
  buildLaunchArgs,
  getIgnoreDefaultArgs,
  type Engine,
} from './browser-helpers.js';

// Re-export for backward compatibility
export {resolveAutoConnectTarget};

let browserManager: BrowserManager | undefined;

export type Channel =
  // Chromium (CDP) — schema collapses chrome/chrome-* aliases into stable/beta/dev/canary
  | 'stable'
  | 'beta'
  | 'dev'
  | 'canary'
  | 'chromium'
  // Chromium (WebDriver BiDi)
  | 'bidi-chromium'
  | 'bidi-chrome'
  | 'bidi-chrome-beta'
  | 'bidi-chrome-dev'
  | 'bidi-chrome-canary'
  // Firefox
  | 'firefox'
  | 'moz-firefox';

export function isPatchrightDetachedFrameError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === 'Frame was detached' &&
    (error.stack?.includes('patchright-core') ?? false)
  );
}

export async function ensureBrowserConnected(options: {
  browserURL?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  devtools: boolean;
}) {
  const config: BrowserManagerConfig = {
    browserURL: options.browserURL,
    wsEndpoint: options.wsEndpoint,
    wsHeaders: options.wsHeaders,
    devtools: options.devtools,
  };

  const manager = BrowserManager.getInstance(config);
  return manager.ensureBrowser();
}

interface McpLaunchOptions {
  acceptInsecureCerts?: boolean;
  executablePath?: string;
  channel?: Channel;
  userDataDir?: string;
  headless: boolean;
  isolated: boolean;
  logFile?: fs.WriteStream;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools: boolean;
}

export async function launch(options: McpLaunchOptions): Promise<Browser> {
  const {channel, executablePath, headless, isolated} = options;
  const engine = resolveEngine(channel);

  let userDataDir = resolveUserDataDir(isolated, options.userDataDir, channel);
  if (userDataDir) {
    await ensureUserDataDir(userDataDir);
  }

  const args = buildLaunchArgs(options.args, engine, {headless, devtools: options.devtools});
  const launchChannel = resolveLaunchChannel(channel, engine, !!executablePath);
  const launcher = engine === 'firefox' ? firefox : chromium;
  const ignoreDefaultArgs = getIgnoreDefaultArgs(engine);

  try {
    const browser = await launcher.launch({
      channel: launchChannel,
      executablePath,
      headless,
      args,
      ...(ignoreDefaultArgs ? {ignoreDefaultArgs} : {}),
    });

    if (options.viewport) {
      const context = browser.contexts()[0];
      const page = context?.pages()[0];
      if (page) {
        await page.setViewportSize({
          width: options.viewport.width,
          height: options.viewport.height,
        });
      }
    }
    return browser;
  } catch (error) {
    if (
      userDataDir &&
      (error as Error).message.includes('The browser is already running')
    ) {
      throw new Error(
        `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
        {cause: error},
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<Browser> {
  const config: BrowserManagerConfig = {
    headless: options.headless,
    executablePath: options.executablePath,
    channel: options.channel,
    isolated: options.isolated,
    userDataDir: options.userDataDir,
    acceptInsecureCerts: options.acceptInsecureCerts,
    viewport: options.viewport,
    args: options.args,
    devtools: options.devtools,
  };

  const manager = BrowserManager.getInstance(config);
  return manager.ensureBrowser();
}

/**
 * Configuration options for BrowserManager
 */
export interface BrowserManagerConfig {
  headless?: boolean;
  executablePath?: string;
  channel?: Channel;
  isolated?: boolean;
  browserURL?: string;
  wsEndpoint?: string;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  wsHeaders?: Record<string, string>;
  useStealthScripts?: boolean;
  acceptInsecureCerts?: boolean;
  userDataDir?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools?: boolean;
  // 新增：自动启动浏览器能力（合并自 BrowserModeManager）
  autoLaunch?: boolean;
  browserPath?: string;
  waitForBrowserTimeoutMs?: number;
  waitForBrowserPollMs?: number;
  timeout?: number;
  maxCollectedUrls?: number;
  maxFilesPerCollect?: number;
  maxTotalContentSize?: number;
  maxSingleFileSize?: number;
  userAgent?: string;
}

/**
 * Singleton BrowserManager class that manages a single browser instance
 * with support for stealth injection, crash detection, and auto-restart.
 * Built on Playwright (replaces Puppeteer).
 */
export class BrowserManager {
  private browser?: Browser;
  private context?: BrowserContext;
  private currentPage: Page | null = null;
  private config: BrowserManagerConfig;
  private stealthInjected = false;
  private crashCheckInterval?: NodeJS.Timeout;
  private isRestarting = false;
  private detachedFrameGuard?: (error: Error) => void;
  private launchPromise: Promise<Browser> | null = null;

  private constructor(config: BrowserManagerConfig) {
    const remoteDebuggingUrl = config.remoteDebuggingUrl;
    this.config = {
      headless: false,
      isolated: false,
      useStealthScripts: false,
      devtools: false,
      browserURL:
        config.browserURL ??
        (remoteDebuggingUrl?.startsWith('http')
          ? remoteDebuggingUrl
          : undefined),
      wsEndpoint:
        config.wsEndpoint ??
        (remoteDebuggingUrl?.startsWith('ws') ? remoteDebuggingUrl : undefined),
      ...config,
    };
  }

  static getInstance(config?: BrowserManagerConfig): BrowserManager {
    if (!browserManager) {
      if (!config) {
        throw new Error(
          'BrowserManager must be initialized with config on first call',
        );
      }
      browserManager = new BrowserManager(config);
    }
    return browserManager;
  }

  static async resetInstance(): Promise<void> {
    if (browserManager) {
      try {
        await browserManager.close();
      } catch (err) {
        logger.debug('Error closing browser during reset:', err);
      }
      browserManager = undefined;
    }
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    // Reuse in-flight launch to prevent concurrent launches
    if (this.launchPromise) {
      return this.launchPromise;
    }

    const doLaunch = async (): Promise<Browser> => {
      if (
        this.config.browserURL ||
        this.config.wsEndpoint ||
        this.config.remoteDebuggingUrl
      ) {
        return this.connectToRemoteBrowser();
      }
      return this.launchBrowser();
    };

    this.launchPromise = doLaunch().finally(() => {
      this.launchPromise = null;
    });

    return this.launchPromise;
  }

  async launch(): Promise<Browser> {
    return this.ensureBrowser();
  }

  getBrowser(): Browser | null {
    return this.browser ?? null;
  }

  getContext(): BrowserContext | null {
    return this.context ?? null;
  }

  async newPage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    let ctx = this.context ?? browser.contexts()[0];
    if (!ctx) {
      ctx = await browser.newContext({bypassCSP: true});
      this.context = ctx;
    }
    const page = await ctx.newPage();
    this.trackCurrentPage(page);
    return page;
  }

  private trackCurrentPage(page: Page): void {
    this.currentPage = page;
    page.once('close', () => {
      if (this.currentPage === page) {
        this.currentPage = null;
      }
    });
  }

  setCurrentPage(page: Page | null): void {
    if (!page) {
      this.currentPage = null;
      return;
    }
    this.trackCurrentPage(page);
  }

  getCurrentPage(): Page | null {
    return this.currentPage && !this.currentPage.isClosed()
      ? this.currentPage
      : null;
  }

  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  // ─── Remote Connection ───────────────────────────────────────────────

  private async connectToRemoteBrowser(): Promise<Browser> {
    try {
      const debugUrl =
        this.config.wsEndpoint ||
        this.config.browserURL ||
        this.config.remoteDebuggingUrl;
      logger.debug('Connecting to remote browser at:', debugUrl);

      // Fetch version info and resolve WebSocket endpoint
      const versionInfo = await this.fetchVersionInfo();
      const connectEndpoint =
        this.config.wsEndpoint ||
        versionInfo.webSocketDebuggerUrl ||
        this.config.browserURL ||
        this.config.remoteDebuggingUrl;

      // Connect via CDP
      this.installDetachedFrameGuard();
      this.browser = await chromium.connectOverCDP(connectEndpoint!, {
        timeout: 30000,
        ...(this.config.wsHeaders ? {headers: this.config.wsHeaders} : {}),
      });
      logger.debug('Connected to remote browser via Playwright');
      this.context = this.browser.contexts()[0];

      // Post-connection setup
      await this.configureRemoteViewport();
      this.logBrowserVersion();
      this.setupCrashDetection();

      if (this.config.useStealthScripts) {
        await this.injectStealth();
      }

      return this.browser;
    } catch (error) {
      // Auto-launch fallback
      if (this.config.autoLaunch) {
        logger.debug(
          'Remote browser connection failed, attempting auto-launch...',
        );
        try {
          await this.launchBrowserProcess();
          return this.connectToRemoteBrowser();
        } catch (launchError) {
          logger.debug('Auto-launch failed:', launchError);
          throw error;
        }
      }

      throw this.mapConnectionError(error);
    }
  }

  private async fetchVersionInfo(): Promise<{
    webSocketDebuggerUrl?: string;
    Browser?: string;
    'Protocol-Version'?: string;
  }> {
    const browserURL = this.config.browserURL || this.config.remoteDebuggingUrl;
    if (!browserURL) {
      return {};
    }

    try {
      const response = await fetch(`${browserURL}/json/version`);
      if (!response.ok) {
        logger.debug(
          'Warning: /json/version returned non-OK status:',
          response.status,
        );
        // Chrome 144+/147+ 在 Way 1（chrome://inspect/#remote-debugging）
        // 模式下禁用了 HTTP /json/* 发现端点——它仍把端口与 ws path 写到
        // DevToolsActivePort。读文件兜底合成 ws:// 端点，让 Playwright
        // 不再做二次 /json/version 探测。这是 Way 1 模式能跑通 cdp 的关键。
        const fallback = this.buildDevToolsActivePortFallback(browserURL);
        if (fallback) {
          logger.debug(
            `[fetchVersionInfo] falling back to DevToolsActivePort wsPath: ${fallback}`,
          );
          return {webSocketDebuggerUrl: fallback};
        }
        return {};
      }
      const versionInfo = (await response.json()) as {
        Browser?: string;
        'Protocol-Version'?: string;
        webSocketDebuggerUrl?: string;
      };
      logger.debug('Browser version info:', {
        browser: versionInfo.Browser,
        protocolVersion: versionInfo['Protocol-Version'],
      });
      return versionInfo;
    } catch (err) {
      logger.debug('Warning: Could not fetch browser version:', err);
      return {};
    }
  }

  /**
   * Build a `ws://127.0.0.1:<port><wsPath>` endpoint from the local Chrome
   * profile's `DevToolsActivePort` file, but only when its port matches the
   * one in `browserURL`. Returns `null` when there's no live Chrome profile
   * on disk, the port doesn't match (would attach to a different browser
   * instance than the user asked for), or the file is malformed.
   */
  private buildDevToolsActivePortFallback(browserURL: string): string | null {
    let urlPort: number;
    try {
      const parsed = new URL(browserURL);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      urlPort = parsed.port ? Number(parsed.port) : 0;
    } catch {
      return null;
    }
    if (!Number.isFinite(urlPort) || urlPort <= 0) {
      return null;
    }
    const active = readDevToolsActivePort();
    if (!active || active.port !== urlPort || !active.wsPath) {
      return null;
    }
    return `ws://127.0.0.1:${active.port}${active.wsPath}`;
  }

  private async configureRemoteViewport(): Promise<void> {
    if (!this.context) return;

    const pages = this.context.pages();
    if (pages.length === 0) return;

    const page = pages[0];
    this.trackCurrentPage(page);

    try {
      const client = await this.context.newCDPSession(page);
      const {bounds} = await client.send('Browser.getWindowForTarget', {});

      logger.debug(
        `Browser window bounds: ${bounds.width}x${bounds.height} at (${bounds.left}, ${bounds.top})`,
      );

      if (this.config.viewport) {
        await page.setViewportSize({
          width: this.config.viewport.width,
          height: this.config.viewport.height,
        });
        logger.debug(
          `Viewport set to ${this.config.viewport.width}x${this.config.viewport.height} (configured)`,
        );
      } else {
        await page.setViewportSize({
          width: bounds.width,
          height: bounds.height,
        });
        logger.debug(
          `Viewport auto-adapted to ${bounds.width}x${bounds.height} (from browser window)`,
        );
      }

      await client.detach();
    } catch (err) {
      logger.debug('Warning: Could not set viewport from browser bounds:', err);
    }
  }

  private logBrowserVersion(): void {
    try {
      const browserVersion = this.browser!.version();
      logger.debug('Browser version:', browserVersion);
    } catch (versionErr) {
      logger.debug('Warning: Could not get browser version:', versionErr);
    }
  }

  private mapConnectionError(error: unknown): Error {
    const errorMessage = (error as Error).message;

    if (errorMessage.includes('Page.enable')) {
      return new Error(
        `CDP 协议错误：'Page.enable' 命令未找到。
原因：Chrome 版本与 Playwright 不兼容，或连接到了错误的端点。

解决方法：
1. 更新 Chrome 到最新版本
2. 确保使用 --remote-debugging-port 启动 Chrome
3. 检查是否连接到了正确的 WebSocket 端点
4. 尝试重启 Chrome 后重新连接

原始错误：${errorMessage}`,
        {cause: error},
      );
    }

    if (errorMessage.includes('connect ECONNREFUSED')) {
      return new Error(
        `无法连接到 Chrome：连接被拒绝。

解决方法：
1. 确认 Chrome 已通过 --remote-debugging-port 启动
2. 检查端口号是否正确（默认 9222）
3. 访问 http://127.0.0.1:<端口>/json/version 验证

原始错误：${errorMessage}`,
        {cause: error},
      );
    }

    if (
      /does not look like a devtools server/i.test(errorMessage) ||
      /404 when connecting to .*\/json\/version/i.test(errorMessage)
    ) {
      return new Error(
        `无法通过 HTTP /json/version 探测到 DevTools 端点。
原因：Chrome 144+ 在勾选 chrome://inspect/#remote-debugging 后默认禁用了
      HTTP /json/* 发现端点（/json/version 一直返回 404），但 ws 路径仍可用。

解决方法（任选其一）：
1. 用 --wsEndpoint 直接传 ws URL，例如：
     --wsEndpoint ws://127.0.0.1:<port>/devtools/browser/<uuid>
   其中 <port> 与 <uuid> 见 DevToolsActivePort 文件：
     %LOCALAPPDATA%\\Google\\Chrome\\User Data\\DevToolsActivePort
2. 用 --remote-debugging-port=<port> --user-data-dir=<非默认目录> 启动一个
   独立的 Chrome 进程（Way 2），可同时使用 --browserUrl。
3. 在配置文件中显式给出 wsEndpoint，而不是依赖 HTTP 自动发现。

原始错误：${errorMessage}`,
        {cause: error},
      );
    }

    return new Error(`Failed to connect to remote browser: ${errorMessage}`, {
      cause: error,
    });
  }

  // ─── Launch ──────────────────────────────────────────────────────────

  private async launchBrowser(): Promise<Browser> {
    const {channel, executablePath, headless, isolated, useStealthScripts} =
      this.config;
    const engine = resolveEngine(channel);

    let userDataDir = resolveUserDataDir(isolated, this.config.userDataDir, channel);
    if (userDataDir) {
      await ensureUserDataDir(userDataDir);
    }

    const args = buildLaunchArgs(this.config.args, engine, {
      headless,
      devtools: this.config.devtools,
      useStealthScripts,
      includeDefaults: true,
    });

    const launchChannel = resolveLaunchChannel(channel, engine, !!executablePath);
    const launcher = engine === 'firefox' ? firefox : chromium;
    const ignoreDefaultArgs = getIgnoreDefaultArgs(engine);

    try {
      logger.debug('Launching browser with config:', {
        engine,
        channel: launchChannel,
        executablePath,
        headless,
        isolated,
        useStealthScripts,
      });

      this.browser = await launcher.launch({
        channel: launchChannel,
        executablePath,
        headless,
        args,
        ...(ignoreDefaultArgs ? {ignoreDefaultArgs} : {}),
      });

      logger.debug('Browser launched successfully');

      // 获取默认 BrowserContext
      let ctx = this.browser.contexts()[0] ?? undefined;
      if (!ctx) {
        ctx = await this.browser.newContext({
          bypassCSP: true,
          ignoreHTTPSErrors: this.config.acceptInsecureCerts,
        });
      }
      this.context = ctx;

      // Firefox 启动后默认 BrowserContext 不包含 page（Chromium 会自动建
      // 一个 about:blank tab），需要主动补一个，避免所有依赖 getSelectedPage
      // 的工具在 firefox 通道下启动后就抛 "没有选中的页面"。
      if (engine === 'firefox' && ctx.pages().length === 0) {
        const fallbackPage = await ctx.newPage();
        this.trackCurrentPage(fallbackPage);
      }

      this.setupCrashDetection();

      // Set viewport if configured
      if (this.config.viewport) {
        const ctx = this.browser.contexts()[0];
        const page = ctx?.pages()[0];
        if (page) {
          this.trackCurrentPage(page);
          await page.setViewportSize({
            width: this.config.viewport.width,
            height: this.config.viewport.height,
          });
        }
      }

      if (useStealthScripts) {
        this.stealthInjected = true;
      }

      return this.browser;
    } catch (error) {
      if (
        userDataDir &&
        (error as Error).message.includes('The browser is already running')
      ) {
        throw new Error(
          `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
          {cause: error},
        );
      }
      throw new Error(`Failed to launch browser: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  // ─── Crash Detection ─────────────────────────────────────────────────

  private setupCrashDetection(): void {
    if (!this.browser) return;

    if (this.crashCheckInterval) {
      clearInterval(this.crashCheckInterval);
    }

    this.browser.on('disconnected', () => {
      logger.debug('Browser closed');
      if (!this.isRestarting) {
        void this.handleBrowserCrash();
      }
    });

    this.crashCheckInterval = setInterval(() => {
      if (this.browser && !this.browser.isConnected() && !this.isRestarting) {
        logger.debug('Browser connection lost, attempting restart');
        void this.handleBrowserCrash();
      }
    }, 5000);
  }

  private async handleBrowserCrash(): Promise<void> {
    if (this.isRestarting || !this.browser) return;

    this.isRestarting = true;
    logger.debug('Attempting to restart browser after crash');

    try {
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (err) {
          logger.debug('Error closing crashed browser:', err);
        }
        this.browser = undefined;
        this.context = undefined;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.ensureBrowser();
      logger.debug('Browser restarted successfully');
    } catch (error) {
      logger.debug('Failed to restart browser:', error);
    } finally {
      this.isRestarting = false;
    }
  }

  // ─── Detached Frame Guard ────────────────────────────────────────────

  private installDetachedFrameGuard(): void {
    if (this.detachedFrameGuard) {
      return;
    }

    this.detachedFrameGuard = error => {
      if (isPatchrightDetachedFrameError(error)) {
        logger.debug('Ignoring transient Patchright detached frame event');
        return;
      }

      process.removeListener('uncaughtException', this.detachedFrameGuard!);
      this.detachedFrameGuard = undefined;
      throw error;
    };

    process.on('uncaughtException', this.detachedFrameGuard);
  }

  private removeDetachedFrameGuard(): void {
    if (!this.detachedFrameGuard) {
      return;
    }

    process.removeListener('uncaughtException', this.detachedFrameGuard);
    this.detachedFrameGuard = undefined;
  }

  // ─── Stealth ─────────────────────────────────────────────────────────

  async injectStealth(
    preset?: StealthPreset,
    options?: StealthInjectionOptions,
  ): Promise<void> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    if (this.stealthInjected) {
      logger.debug('Stealth scripts already injected');
      return;
    }

    try {
      const stealthOptions: StealthInjectionOptions = {
        preset: preset ?? 'windows-chrome',
        ...options,
      };

      for (const ctx of this.browser.contexts()) {
        for (const page of ctx.pages()) {
          await StealthScripts2025.injectAll(page, stealthOptions);
        }

        ctx.on('page', async page => {
          await StealthScripts2025.injectAll(page, stealthOptions);
        });
      }

      this.stealthInjected = true;
      logger.debug('Advanced stealth scripts injected successfully');
    } catch (error) {
      throw new Error(
        `Failed to inject stealth scripts: ${(error as Error).message}`,
        {cause: error},
      );
    }
  }

  getStealthPresets(): Array<{
    name: StealthPreset;
    userAgent: string;
    platform: string;
  }> {
    return StealthScripts2025.getPresets();
  }

  getStealthFeatures(): string[] {
    return [
      'hideWebDriver',
      'mockChrome',
      'setUserAgent',
      'fixPermissions',
      'mockPlugins',
      'canvasNoise',
      'webglOverride',
      'audioContextNoise',
      'fixLanguages',
      'mockBattery',
      'mockMediaDevices',
      'mockNotifications',
      'mockConnection',
      'focusOverride',
      'performanceNoise',
      'overrideScreen',
    ];
  }

  // ─── Auto-Launch ─────────────────────────────────────────────────────

  private async launchBrowserProcess(): Promise<void> {
    const port = this.config.remoteDebuggingPort ?? 9222;
    const browsers = detectAllBrowsers(this.config.browserPath);

    if (browsers.length === 0) {
      throw new Error(
        'Cannot find browser executable. Please specify browserPath in config.\n' +
          'Supported browsers: Chrome, Edge',
      );
    }

    const selectedBrowser = browsers[0];
    await spawnBrowserProcess(
      port,
      selectedBrowser.path,
      p => this.waitForBrowser(p),
    );
  }

  private async waitForBrowser(port: number): Promise<void> {
    const timeoutMs = this.config.waitForBrowserTimeoutMs ?? 5000;
    const pollMs = this.config.waitForBrowserPollMs ?? 500;
    await waitForBrowserReady(port, timeoutMs, pollMs);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  async restart(): Promise<void> {
    logger.debug('Manually restarting browser');
    await this.close();
    await this.ensureBrowser();
  }

  async close(): Promise<void> {
    if (!this.browser) return;

    if (this.crashCheckInterval) {
      clearInterval(this.crashCheckInterval);
      this.crashCheckInterval = undefined;
    }

    this.removeDetachedFrameGuard();

    const browser = this.browser;
    this.browser = undefined;
    this.context = undefined;
    this.currentPage = null;
    this.stealthInjected = false;

    try {
      await Promise.race([
        browser.close(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timeout')), 5_000),
        ),
      ]);
      logger.debug('Browser closed successfully');
    } catch (error) {
      const pid = (browser as unknown as {process(): {pid?: number} | null}).process()?.pid;
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may already be dead
        }
      }
      logger.debug('Browser close forced:', error);
    }
  }
}
