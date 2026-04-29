/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  chromium,
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

import {HARMFUL_ARGS, DEFAULT_ARGS, STEALTH_ARGS} from './stealth-args.js';

let browserManager: BrowserManager | undefined;

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
  // Use BrowserManager for connection management
  const config: BrowserManagerConfig = {
    browserURL: options.browserURL,
    wsEndpoint: options.wsEndpoint,
    wsHeaders: options.wsHeaders,
    devtools: options.devtools,
  };

  const manager = BrowserManager.getInstance(config);
  return manager.ensureBrowser();
}

/**
 * 发现 Chrome 调试端口
 * 1. 读取 DevToolsActivePort 文件（跨平台）
 * 2. 扫描常见端口 [9222, 9229, 9333]
 * 3. 使用 TCP 探测避免触发 Chrome 安全弹窗
 */
async function discoverChromeDebugPort(): Promise<{
  port: number;
  wsPath?: string;
} | null> {
  // 1. 尝试读取 DevToolsActivePort 文件
  const possiblePaths: string[] = [];
  const platform = os.platform();
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';

  if (platform === 'darwin') {
    possiblePaths.push(
      path.join(
        home,
        'Library/Application Support/Google/Chrome/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Google/Chrome Canary/DevToolsActivePort',
      ),
      path.join(
        home,
        'Library/Application Support/Chromium/DevToolsActivePort',
      ),
    );
  } else if (platform === 'linux') {
    possiblePaths.push(
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
    );
  } else if (platform === 'win32') {
    possiblePaths.push(
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
    );
  }

  for (const filePath of possiblePaths) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const lines = content.split('\n').filter(Boolean);
      const port = parseInt(lines[0], 10);
      if (port > 0 && port < 65536) {
        const ok = await checkPort(port);
        if (ok) {
          const wsPath = lines[1] || null;
          logger.debug(
            `[discoverChromeDebugPort] 从 DevToolsActivePort 发现端口：${port}${wsPath ? ' (带 wsPath)' : ''}`,
          );
          return {port, wsPath: wsPath || undefined};
        }
      }
    } catch {
      // 文件不存在，继续尝试
    }
  }

  // 2. 扫描常见端口
  const commonPorts = [9222, 9229, 9333];
  for (const port of commonPorts) {
    const ok = await checkPort(port);
    if (ok) {
      logger.debug(
        `[discoverChromeDebugPort] 扫描发现 Chrome 调试端口：${port}`,
      );
      return {port, wsPath: undefined};
    }
  }

  return null;
}

/**
 * TCP 端口探测（避免触发 Chrome 安全弹窗）
 */
function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function resolveAutoConnectTarget(options?: {
  candidates?: string[];
  fetchImpl?: typeof fetch;
}): Promise<{browserURL: string; wsEndpoint?: string} | undefined> {
  const fetchImpl = options?.fetchImpl ?? fetch;

  // 1. 如果提供了 candidates 参数，优先使用 candidates（测试模式）
  if (options?.candidates && options.candidates.length > 0) {
    for (const candidate of options.candidates) {
      try {
        const response = await fetchImpl(`${candidate}/json/version`);
        if (!response.ok) {
          continue;
        }
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: string;
        };
        return {
          browserURL: candidate,
          wsEndpoint: payload.webSocketDebuggerUrl,
        };
      } catch {
        // Keep probing the next candidate.
      }
    }
    return undefined;
  }

  // 2. 自动发现 Chrome 调试端口（生产模式）
  const discovered = await discoverChromeDebugPort();
  if (discovered) {
    const {port, wsPath} = discovered;
    const browserURL = `http://127.0.0.1:${port}`;

    // 尝试获取完整的 WebSocket URL
    try {
      const response = await fetchImpl(`${browserURL}/json/version`);
      if (response.ok) {
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: string;
        };
        return {
          browserURL,
          wsEndpoint:
            payload.webSocketDebuggerUrl || wsPath
              ? `ws://127.0.0.1:${port}${wsPath || '/devtools/browser'}`
              : undefined,
        };
      }
    } catch {
      // 如果 /json/version 失败，返回基础 URL
      return {browserURL};
    }
  }

  // 3. 回退到默认候选列表
  const candidates = [
    'http://127.0.0.1:9222',
    'http://127.0.0.1:9223',
    'http://127.0.0.1:9224',
    'http://127.0.0.1:9225',
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetchImpl(`${candidate}/json/version`);
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as {
        webSocketDebuggerUrl?: string;
      };
      return {
        browserURL: candidate,
        wsEndpoint: payload.webSocketDebuggerUrl,
      };
    } catch {
      // Keep probing the next candidate.
    }
  }

  return undefined;
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
  const profileDirName =
    channel && channel !== 'stable'
      ? `chrome-profile-${channel}`
      : 'chrome-profile';

  let userDataDir = options.userDataDir;
  if (!isolated && !userDataDir) {
    userDataDir = path.join(
      os.homedir(),
      '.cache',
      'chrome-devtools-mcp',
      profileDirName,
    );
    await fs.promises.mkdir(userDataDir, {
      recursive: true,
    });
  }

  const args = [...(options.args ?? []), '--hide-crash-restore-bubble'];
  if (headless) {
    args.push('--screen-info={3840x2160}');
  }

  let launchChannel: string | undefined;
  if (options.devtools) {
    args.push('--auto-open-devtools-for-tabs');
  }
  if (!executablePath) {
    launchChannel =
      channel && channel !== 'stable' ? `chrome-${channel}` : 'chrome';
  }

  try {
    const browser = await chromium.launch({
      channel: launchChannel,
      executablePath,
      headless,
      args,
      ignoreDefaultArgs: HARMFUL_ARGS,
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
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<Browser> {
  // Use BrowserManager for browser management
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

export type Channel = 'stable' | 'canary' | 'beta' | 'dev';

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
  remoteDebuggingPort?: number;
  waitForBrowserTimeoutMs?: number;
  waitForBrowserPollMs?: number;
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

  /**
   * Get the singleton instance of BrowserManager
   */
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

  /**
   * Reset the singleton instance (useful for testing)
   */
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

  /**
   * Ensure browser is connected and running
   */
  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    // If we have a remote debugging URL, connect to existing browser
    if (
      this.config.browserURL ||
      this.config.wsEndpoint ||
      this.config.remoteDebuggingUrl
    ) {
      return this.connectToRemoteBrowser();
    }

    // Otherwise launch a new browser
    return this.launchBrowser();
  }

  /**
   * Launch browser and return instance (alias for ensureBrowser, for BrowserModeManager compatibility)
   */
  async launch(): Promise<Browser> {
    return this.ensureBrowser();
  }

  /**
   * Get the current browser instance
   */
  getBrowser(): Browser | null {
    return this.browser ?? null;
  }

  /**
   * Get the current browser context
   */
  getContext(): BrowserContext | null {
    return this.context ?? null;
  }

  /**
   * Create a new page in the browser
   */
  async newPage(): Promise<Page> {
    const browser = await this.ensureBrowser();
    let ctx = this.context ?? browser.contexts()[0];
    if (!ctx) {
      ctx = await browser.newContext();
      this.context = ctx;
    }
    const pages = ctx.pages();
    const page = pages.length > 0 ? pages[0] : await ctx.newPage();
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

  /**
   * Get current page
   */
  getCurrentPage(): Page | null {
    return this.currentPage && !this.currentPage.isClosed()
      ? this.currentPage
      : null;
  }

  /**
   * Check if browser is connected
   */
  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  /**
   * Connect to a remote browser instance via CDP
   */
  private async connectToRemoteBrowser(): Promise<Browser> {
    try {
      const debugUrl =
        this.config.wsEndpoint ||
        this.config.browserURL ||
        this.config.remoteDebuggingUrl;

      logger.debug('Connecting to remote browser at:', debugUrl);

      // First, verify the endpoint is accessible and get version info
      let browserURL: string | undefined;
      let webSocketDebuggerUrl: string | undefined;
      if (this.config.browserURL || this.config.remoteDebuggingUrl) {
        browserURL = this.config.browserURL || this.config.remoteDebuggingUrl;
        try {
          const response = await fetch(`${browserURL}/json/version`);
          if (response.ok) {
            const versionInfo = (await response.json()) as {
              Browser?: string;
              'Protocol-Version'?: string;
              webSocketDebuggerUrl?: string;
            };
            logger.debug('Browser version info:', {
              browser: versionInfo.Browser,
              protocolVersion: versionInfo['Protocol-Version'],
            });
            webSocketDebuggerUrl = versionInfo.webSocketDebuggerUrl;
          } else {
            logger.debug(
              'Warning: /json/version returned non-OK status:',
              response.status,
            );
          }
        } catch (err) {
          logger.debug('Warning: Could not fetch browser version:', err);
        }
      }

      // Use Playwright connectOverCDP
      // Prefer explicit WebSocket endpoint over browserURL
      const connectEndpoint =
        this.config.wsEndpoint ||
        webSocketDebuggerUrl ||
        this.config.browserURL ||
        this.config.remoteDebuggingUrl;

      const connectOptions = {
        timeout: 30000,
        ...(this.config.wsHeaders ? {headers: this.config.wsHeaders} : {}),
      };

      this.installDetachedFrameGuard();
      this.browser = await chromium.connectOverCDP(
        connectEndpoint!,
        connectOptions,
      );
      logger.debug('Connected to remote browser via Playwright');

      // Get the default context
      this.context = this.browser.contexts()[0];

      // 连接成功后，获取浏览器窗口边界并应用到页面（自动适配）
      try {
        if (this.context) {
          const pages = this.context.pages();
          if (pages.length > 0) {
            const page = pages[0];
            this.trackCurrentPage(page);

            // 使用 CDP 命令获取浏览器窗口边界
            const client = await this.context.newCDPSession(page);
            const {windowId: _windowId, bounds} = await client.send(
              'Browser.getWindowForTarget',
              {},
            );

            logger.debug(
              `Browser window bounds: ${bounds.width}x${bounds.height} at (${bounds.left}, ${bounds.top})`,
            );

            // 优先使用配置的 viewport，否则使用浏览器窗口边界
            if (this.config.viewport) {
              await page.setViewportSize({
                width: this.config.viewport.width,
                height: this.config.viewport.height,
              });
              logger.debug(
                `Viewport set to ${this.config.viewport.width}x${this.config.viewport.height} (configured)`,
              );
            } else {
              // 自动适配：使用浏览器窗口边界作为 viewport
              await page.setViewportSize({
                width: bounds.width,
                height: bounds.height,
              });
              logger.debug(
                `Viewport auto-adapted to ${bounds.width}x${bounds.height} (from browser window)`,
              );
            }

            await client.detach();
          }
        }
      } catch (err) {
        logger.debug(
          'Warning: Could not set viewport from browser bounds:',
          err,
        );
      }

      // Verify connection by checking browser version
      try {
        const browserVersion = this.browser.version();
        logger.debug('Browser version:', browserVersion);
      } catch (versionErr) {
        logger.debug('Warning: Could not get browser version:', versionErr);
      }

      // Set up crash detection
      this.setupCrashDetection();

      // Inject stealth if configured
      if (this.config.useStealthScripts) {
        await this.injectStealth();
      }

      return this.browser;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // 如果连接失败但配置了 autoLaunch，尝试自动启动浏览器
      if (this.config.autoLaunch) {
        logger.debug(
          'Remote browser connection failed, attempting auto-launch...',
        );
        try {
          await this.launchBrowserProcess();
          // 重新尝试连接
          return this.connectToRemoteBrowser();
        } catch (launchError) {
          logger.debug('Auto-launch failed:', launchError);
          // 抛出原始连接错误，因为 autoLaunch 只是回退方案
          throw error;
        }
      }

      // Provide specific guidance for common connection issues
      if (errorMessage.includes('Page.enable')) {
        throw new Error(
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
        throw new Error(
          `无法连接到 Chrome：连接被拒绝。

解决方法：
1. 确认 Chrome 已通过 --remote-debugging-port 启动
2. 检查端口号是否正确（默认 9222）
3. 访问 http://127.0.0.1:<端口>/json/version 验证

原始错误：${errorMessage}`,
          {cause: error},
        );
      }

      throw new Error(`Failed to connect to remote browser: ${errorMessage}`, {
        cause: error,
      });
    }
  }

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

  /**
   * Launch a new browser instance using Playwright
   */
  private async launchBrowser(): Promise<Browser> {
    const {channel, executablePath, headless, isolated, useStealthScripts} =
      this.config;

    const profileDirName =
      channel && channel !== 'stable'
        ? `chrome-profile-${channel}`
        : 'chrome-profile';

    let userDataDir = this.config.userDataDir;
    if (!isolated && !userDataDir) {
      userDataDir = path.join(
        os.homedir(),
        '.cache',
        'chrome-devtools-mcp',
        profileDirName,
      );
      await fs.promises.mkdir(userDataDir, {
        recursive: true,
      });
    }

    // Build args: start with DEFAULT_ARGS, add user args, then STEALTH_ARGS if enabled
    const args = [
      ...DEFAULT_ARGS,
      ...(this.config.args ?? []),
      '--hide-crash-restore-bubble',
    ];

    // Add stealth args if useStealthScripts is enabled
    if (useStealthScripts) {
      args.push(...STEALTH_ARGS);
    }

    if (headless) {
      args.push('--screen-info={3840x2160}');
    }

    let launchChannel: string | undefined;
    if (this.config.devtools) {
      args.push('--auto-open-devtools-for-tabs');
    }

    if (!executablePath) {
      launchChannel =
        channel && channel !== 'stable' ? `chrome-${channel}` : 'chrome';
    }

    try {
      logger.debug('Launching browser with config:', {
        channel: launchChannel,
        executablePath,
        headless,
        isolated,
        useStealthScripts,
      });

      this.browser = await chromium.launch({
        channel: launchChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: HARMFUL_ARGS,
      });

      logger.debug('Browser launched successfully');

      // Set up crash detection
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

      // Mark stealth as injected if enabled
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
          {
            cause: error,
          },
        );
      }
      throw new Error(`Failed to launch browser: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * Set up crash detection and auto-restart
   */
  private setupCrashDetection(): void {
    if (!this.browser) return;

    // Clear any existing interval
    if (this.crashCheckInterval) {
      clearInterval(this.crashCheckInterval);
    }

    // Listen for disconnect events (Playwright's equivalent of Puppeteer 'disconnected')
    this.browser.on('disconnected', () => {
      logger.debug('Browser closed');
      if (!this.isRestarting) {
        void this.handleBrowserCrash();
      }
    });

    // Periodically check if browser is still connected
    this.crashCheckInterval = setInterval(() => {
      if (this.browser && !this.browser.isConnected() && !this.isRestarting) {
        logger.debug('Browser connection lost, attempting restart');
        void this.handleBrowserCrash();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Handle browser crash by attempting to restart
   */
  private async handleBrowserCrash(): Promise<void> {
    if (this.isRestarting || !this.browser) return;

    this.isRestarting = true;
    logger.debug('Attempting to restart browser after crash');

    try {
      // Clean up old browser instance
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (err) {
          // Ignore errors when closing crashed browser
          logger.debug('Error closing crashed browser:', err);
        }
        this.browser = undefined;
        this.context = undefined;
      }

      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Restart browser
      await this.ensureBrowser();
      logger.debug('Browser restarted successfully');
    } catch (error) {
      logger.debug('Failed to restart browser:', error);
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * Inject stealth scripts into all pages using advanced StealthScripts2025
   * @param preset - Platform preset (windows-chrome, mac-chrome, etc.)
   * @param options - Custom stealth options to override preset
   */
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

      // Inject stealth into all pages across all contexts
      for (const ctx of this.browser.contexts()) {
        for (const page of ctx.pages()) {
          await StealthScripts2025.injectAll(page, stealthOptions);
        }

        // Listen for new pages and inject stealth
        ctx.on('page', async page => {
          await StealthScripts2025.injectAll(page, stealthOptions);
        });
      }

      this.stealthInjected = true;
      logger.debug('Advanced stealth scripts injected successfully');
    } catch (error) {
      throw new Error(
        `Failed to inject stealth scripts: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Get available stealth presets
   */
  getStealthPresets(): Array<{
    name: StealthPreset;
    userAgent: string;
    platform: string;
  }> {
    return StealthScripts2025.getPresets();
  }

  /**
   * Get list of available stealth features
   */
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

  /**
   * Launch browser process with remote debugging (auto-launch capability)
   */
  private async launchBrowserProcess(): Promise<void> {
    const port = this.config.remoteDebuggingPort ?? 9222;
    const browsers = this.detectAllBrowsers();

    if (browsers.length === 0) {
      throw new Error(
        'Cannot find browser executable. Please specify browserPath in config.\n' +
          'Supported browsers: Chrome, Edge',
      );
    }

    const selectedBrowser = browsers[0];
    logger.debug(`Launching browser: ${selectedBrowser.path}`);
    logger.debug(`Remote debugging port: ${port}`);

    const {spawn} = await import('node:child_process');
    const browserProcess = spawn(
      selectedBrowser.path,
      [
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      {
        detached: true,
        stdio: 'ignore',
      },
    );

    browserProcess.unref();

    // Wait for browser to be ready
    await this.waitForBrowser(port);
    logger.debug('Browser launched successfully');
  }

  /**
   * Wait for browser to be ready
   */
  private async waitForBrowser(port: number, timeout?: number): Promise<void> {
    const startTime = Date.now();
    const maxTimeout = timeout ?? this.config.waitForBrowserTimeoutMs ?? 5000;
    const pollInterval = this.config.waitForBrowserPollMs ?? 500;

    while (Date.now() - startTime < maxTimeout) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) {
          return;
        }
      } catch {
        // Browser not ready yet, retry
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    throw new Error('Browser failed to start within timeout');
  }

  /**
   * Detect all available browsers
   */
  private detectAllBrowsers(): Array<{name: string; path: string}> {
    const foundBrowsers: Array<{name: string; path: string}> = [];

    // Use configured browser path if specified
    if (this.config.browserPath) {
      try {
        if (fs.existsSync(this.config.browserPath)) {
          foundBrowsers.push({
            name: 'Custom Browser',
            path: this.config.browserPath,
          });
          return foundBrowsers;
        }
      } catch {
        // Ignore and continue with default detection
      }
    }

    if (process.platform !== 'win32') {
      // Unix-like platforms
      const unixCandidates =
        process.platform === 'darwin'
          ? [
              {
                name: 'Chrome (macOS)',
                path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              },
              {
                name: 'Edge (macOS)',
                path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
              },
            ]
          : [
              {name: 'Chrome (linux)', path: '/usr/bin/google-chrome'},
              {name: 'Chrome (linux)', path: '/usr/bin/google-chrome-stable'},
              {name: 'Chromium (linux)', path: '/usr/bin/chromium-browser'},
              {name: 'Chromium (linux)', path: '/usr/bin/chromium'},
              {name: 'Edge (linux)', path: '/usr/bin/microsoft-edge'},
            ];

      const {existsSync} = fs;
      for (const candidate of unixCandidates) {
        if (existsSync(candidate.path)) {
          foundBrowsers.push({name: candidate.name, path: candidate.path});
        }
      }
      return foundBrowsers;
    }

    // Windows: scan common drive letters
    const browserTemplates = [
      {
        name: 'Chrome',
        paths: [
          'Google\\Chrome\\Application\\chrome.exe',
          'Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ],
      },
      {
        name: 'Edge',
        paths: [
          'Microsoft\\Edge\\Application\\msedge.exe',
          'Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ],
      },
    ];

    const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const drive of driveLetters) {
      for (const template of browserTemplates) {
        for (const browserPath of template.paths) {
          const fullPath = `${drive}:\\${browserPath}`;
          if (fs.existsSync(fullPath)) {
            foundBrowsers.push({
              name: `${template.name} (${drive}:)`,
              path: fullPath,
            });
          }
        }
      }
    }

    return foundBrowsers;
  }

  /**
   * Restart the browser
   */
  async restart(): Promise<void> {
    logger.debug('Manually restarting browser');
    await this.close();
    await this.ensureBrowser();
  }

  /**
   * Close the browser and clean up resources
   */
  async close(): Promise<void> {
    this.removeDetachedFrameGuard();

    // Clear crash detection interval
    if (this.crashCheckInterval) {
      clearInterval(this.crashCheckInterval);
      this.crashCheckInterval = undefined;
    }

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
        logger.debug('Browser closed successfully');
      } catch (error) {
        logger.debug('Error closing browser:', error);
      }
      this.browser = undefined;
      this.context = undefined;
    }

    this.stealthInjected = false;
    this.currentPage = null;
  }
}
