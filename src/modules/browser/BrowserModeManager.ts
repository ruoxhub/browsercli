/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';

import type {Browser, Page} from 'puppeteer';
import puppeteer from 'puppeteer';

import {logger} from '../../utils/logger.js';
import {
  StealthScripts2025,
  type StealthPreset,
} from '../stealth/StealthScripts2025.js';

export interface BrowserModeConfig {
  useStealthScripts?: boolean;
  stealthPreset?: StealthPreset;
  remoteDebuggingUrl?: string;
  autoLaunch?: boolean;
  browserPath?: string;
  remoteDebuggingPort?: number;
  waitForBrowserTimeoutMs?: number;
  waitForBrowserPollMs?: number;
  viewport?: {width: number; height: number};
}

interface SessionData {
  cookies?: any[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

type NormalizedBrowserModeConfig = Required<BrowserModeConfig>;

export class BrowserModeManager {
  private static detectedBrowsersCache: Array<{
    name: string;
    path: string;
  }> | null = null;
  private browser: Browser | null = null;
  private currentPage: Page | null = null;
  private readonly config: NormalizedBrowserModeConfig;
  private sessionData: SessionData = {};
  private browserProcess: ChildProcess | null = null;
  private autoLaunched = false;

  constructor(config: BrowserModeConfig = {}) {
    const port = config.remoteDebuggingPort ?? 9222;
    this.config = {
      useStealthScripts: config.useStealthScripts ?? true,
      stealthPreset: config.stealthPreset ?? 'windows-chrome',
      remoteDebuggingUrl:
        config.remoteDebuggingUrl ?? `http://127.0.0.1:${port}`,
      autoLaunch: config.autoLaunch ?? true,
      browserPath: config.browserPath ?? '',
      remoteDebuggingPort: port,
      waitForBrowserTimeoutMs: config.waitForBrowserTimeoutMs ?? 5000,
      waitForBrowserPollMs: config.waitForBrowserPollMs ?? 500,
      viewport: config.viewport,
    } as NormalizedBrowserModeConfig;
  }

  /**
   * 启动浏览器进程（带远程调试）
   */
  private async launchBrowserProcess(): Promise<void> {
    const browsers = this.detectAllBrowsers();

    if (browsers.length === 0) {
      throw new Error(
        'Cannot find browser executable. Please specify browserPath in config.\n' +
          'Supported browsers: Chrome, Edge',
      );
    }

    // 如果发现多个浏览器，使用第一个并记录
    if (browsers.length > 1) {
      logger.info(`🔍 Found ${browsers.length} browsers:`);
      browsers.forEach((b, i) => {
        logger.info(`  ${i + 1}. ${b.name}: ${b.path}`);
      });
      logger.info(`📌 Using: ${browsers[0].name}`);
      logger.info(`💡 To use a different browser, set browserPath in config`);
    }

    const selectedBrowser = browsers[0];
    logger.info(`🚀 Launching browser: ${selectedBrowser.path}`);
    logger.info(`🔌 Remote debugging port: ${this.config.remoteDebuggingPort}`);

    const args = [
      `--remote-debugging-port=${this.config.remoteDebuggingPort}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];

    this.browserProcess = spawn(selectedBrowser.path, args, {
      detached: true,
      stdio: 'ignore',
    });

    this.browserProcess.unref();
    this.autoLaunched = true;

    // 等待浏览器启动
    await this.waitForBrowser(this.config.waitForBrowserTimeoutMs);
    logger.info('✅ Browser launched successfully');
  }

  /**
   * 等待浏览器就绪
   */
  private async waitForBrowser(timeout: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        await puppeteer
          .connect({
            browserURL: this.config.remoteDebuggingUrl,
          })
          .then(browser => browser.disconnect());
        return;
      } catch {
        await new Promise(resolve =>
          setTimeout(resolve, this.config.waitForBrowserPollMs),
        );
      }
    }
    throw new Error('Browser failed to start within timeout');
  }

  /**
   * 检测所有可用浏览器（支持任意盘符）
   */
  private detectAllBrowsers(): Array<{name: string; path: string}> {
    const foundBrowsers: Array<{name: string; path: string}> = [];

    // 如果配置中指定了路径，优先使用
    if (this.config.browserPath && existsSync(this.config.browserPath)) {
      foundBrowsers.push({
        name: 'Custom Browser',
        path: this.config.browserPath,
      });
      return foundBrowsers;
    }

    if (BrowserModeManager.detectedBrowsersCache) {
      return [...BrowserModeManager.detectedBrowsersCache];
    }

    const registerFound = (name: string, path: string): void => {
      if (!foundBrowsers.some(b => b.path === path)) {
        foundBrowsers.push({name, path});
      }
    };

    // 非 Windows 平台直接检测常见路径，避免无意义盘符扫描
    if (process.platform !== 'win32') {
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

      for (const candidate of unixCandidates) {
        if (existsSync(candidate.path)) {
          registerFound(candidate.name, candidate.path);
          logger.info(
            `🔍 Found browser: ${candidate.name} at ${candidate.path}`,
          );
        }
      }

      BrowserModeManager.detectedBrowsersCache = [...foundBrowsers];
      return foundBrowsers;
    }

    // 常见的浏览器安装路径模板
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

    // 检测所有可能的盘符（A-Z）
    const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    for (const drive of driveLetters) {
      for (const template of browserTemplates) {
        for (const browserPath of template.paths) {
          const fullPath = `${drive}:\\${browserPath}`;
          if (existsSync(fullPath)) {
            registerFound(`${template.name} (${drive}:)`, fullPath);
            logger.info(`🔍 Found browser: ${template.name} at ${fullPath}`);
          }
        }
      }
    }

    BrowserModeManager.detectedBrowsersCache = [...foundBrowsers];
    return foundBrowsers;
  }

  async launch(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      logger.info('🔁 Browser already connected, reusing existing session.');
      return this.browser;
    }

    logger.info(
      `🌐 Connecting to browser at ${this.config.remoteDebuggingUrl}...`,
    );

    try {
      this.browser = await puppeteer.connect({
        browserURL: this.config.remoteDebuggingUrl,
        defaultViewport: null, // 保持浏览器自然状态
      });

      logger.info('✅ Successfully connected to browser');

      // 连接成功后，获取浏览器窗口边界并应用到页面（自动适配）
      try {
        const pages = await this.browser.pages();
        if (pages.length > 0) {
          const page = pages[0];
          // @ts-expect-error - target() exists on puppeteer Page
          const targetId = page.target()._targetId;

          // 使用 CDP 命令获取浏览器窗口边界
          const client = await page.createCDPSession();
          // @ts-expect-error - CDP send returns correct type
          const {bounds} = await client.send('Browser.getWindowForTarget', {
            targetId,
          });

          logger.info(
            `📐 Browser window bounds: ${bounds.width}x${bounds.height}`,
          );

          // 优先使用配置的 viewport，否则使用浏览器窗口边界
          if (this.config.viewport) {
            await page.setViewport({
              width: this.config.viewport.width,
              height: this.config.viewport.height,
              deviceScaleFactor: 1,
            });
            logger.info(
              `📐 Viewport set to ${this.config.viewport.width}x${this.config.viewport.height} (configured)`,
            );
          } else {
            // 自动适配：使用浏览器窗口边界作为 viewport
            await page.setViewport({
              width: bounds.width,
              height: bounds.height,
              deviceScaleFactor: 1,
            });
            logger.info(
              `📐 Viewport auto-adapted to ${bounds.width}x${bounds.height} (from browser window)`,
            );
          }

          await client.detach();
        }
      } catch (err) {
        logger.warn('⚠️ Could not set viewport from browser bounds:', err);
      }

      return this.browser;
    } catch (error) {
      logger.warn('⚠️ Failed to connect to existing browser:', error);

      if (this.config.autoLaunch) {
        logger.info('🔄 Attempting to auto-launch browser...');
        try {
          await this.launchBrowserProcess();

          this.browser = await puppeteer.connect({
            browserURL: this.config.remoteDebuggingUrl,
            defaultViewport: null,
          });

          logger.info('✅ Successfully connected to auto-launched browser');
          return this.browser;
        } catch (launchError) {
          logger.error('❌ Failed to auto-launch browser:', launchError);
          throw new Error(
            `Failed to connect and auto-launch browser. ` +
              `Please manually start your browser with: chrome.exe --remote-debugging-port=${this.config.remoteDebuggingPort}`,
          );
        }
      } else {
        throw new Error(
          `Failed to connect to browser at ${this.config.remoteDebuggingUrl}. ` +
            `Please ensure your browser is running with remote debugging enabled. ` +
            `Example: chrome.exe --remote-debugging-port=${this.config.remoteDebuggingPort}`,
        );
      }
    }
  }

  async newPage(): Promise<Page> {
    if (!this.browser) {
      await this.launch();
    }

    // 优先复用远程浏览器的现有页面（保留原始 viewport）
    const existingPages = await this.browser!.pages();
    if (existingPages.length > 0) {
      this.currentPage = existingPages[0];
      logger.info(`♻️ 复用现有页面 (viewport: 自动继承浏览器窗口)`);
    } else {
      // 没有现有页面时才创建新页面
      this.currentPage = await this.browser!.newPage();
      logger.info(`📄 创建新页面`);
    }

    const page = this.currentPage;
    page.on('close', () => {
      if (this.currentPage === page) {
        this.currentPage = null;
      }
    });

    await page.setCacheEnabled(true);
    await page.setBypassCSP(true);
    await page.setJavaScriptEnabled(true);

    // 设置 viewport（仅在配置时覆盖，否则使用 CDP 获取浏览器窗口边界）
    if (this.config.viewport) {
      await page.setViewport({
        width: this.config.viewport.width,
        height: this.config.viewport.height,
        deviceScaleFactor: 1,
      });
      logger.info(
        `📐 Viewport set to ${this.config.viewport.width}x${this.config.viewport.height} (configured)`,
      );
    } else {
      // 自动适配：使用 CDP 获取浏览器窗口边界并设置 viewport
      try {
        // @ts-expect-error - target() exists on puppeteer Page
        const targetId = page.target()._targetId;
        const client = await page.createCDPSession();
        // @ts-expect-error - CDP send returns correct type
        const {bounds} = await client.send('Browser.getWindowForTarget', {
          targetId,
        });

        await page.setViewport({
          width: bounds.width,
          height: bounds.height,
          deviceScaleFactor: 1,
        });
        logger.info(
          `📐 Viewport auto-adapted to ${bounds.width}x${bounds.height} (from browser window)`,
        );

        await client.detach();
      } catch (err) {
        logger.warn('⚠️ Could not auto-adapt viewport:', err);
      }
    }

    if (this.config.useStealthScripts) {
      // 使用平台预设注入反检测脚本（默认 windows-chrome）
      const preset = this.config.stealthPreset ?? 'windows-chrome';
      await StealthScripts2025.injectAll(page, {preset});
    }

    await this.injectAntiDetectionScripts(page);

    if (this.sessionData.cookies?.length) {
      await page.setCookie(...this.sessionData.cookies);
    }

    return page;
  }

  async goto(url: string, page?: Page): Promise<Page> {
    const targetPage = page ?? this.currentPage;
    if (!targetPage) {
      throw new Error('No page available. Call newPage() first.');
    }

    logger.info(`🌐 Navigating to ${url}`);
    await targetPage.goto(url, {waitUntil: 'networkidle2'});

    return targetPage;
  }

  private async injectAntiDetectionScripts(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

      (window as any).chrome = {
        runtime: {
          connect: () => {},
          sendMessage: () => {},
          onMessage: {
            addListener: () => {},
            removeListener: () => {},
          },
        },
      };

      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: {
              type: 'application/pdf',
              suffixes: 'pdf',
              description: 'Portable Document Format',
            },
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Plugin',
          },
        ],
      });

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: (Notification as any).permission,
            } as PermissionStatus)
          : originalQuery(parameters);

      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      });
    });

    logger.info('🛡️ Anti-detection scripts injected');
  }

  async close(): Promise<void> {
    if (!this.browser) {
      return;
    }

    try {
      await this.browser.disconnect();
      logger.info('🔌 Disconnected from browser.');
    } catch (error) {
      logger.warn('Failed to disconnect from browser', error);
    } finally {
      this.browser = null;
      this.currentPage = null;
    }

    // 如果是自动启动的浏览器，终止进程
    if (
      this.autoLaunched &&
      this.browserProcess &&
      !this.browserProcess.killed
    ) {
      try {
        this.browserProcess.kill('SIGTERM');
        this.browserProcess = null;
        this.autoLaunched = false;
        logger.info('🔒 Auto-launched browser process terminated.');
      } catch (error) {
        logger.warn('Failed to terminate browser process', error);
      }
    }
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  getCurrentPage(): Page | null {
    return this.currentPage;
  }

  setCurrentPage(page: Page | null): void {
    this.currentPage = page;
  }
}
