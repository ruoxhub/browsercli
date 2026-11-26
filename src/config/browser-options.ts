/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 浏览器连接与启动选项定义（参考 chrome-devtools-mcp/src/config/browser-options.ts）。
 */

import type {ConfigOption, ConfigOptionsFor} from './category-options.js';
import {CHANNELS, type ChannelInput} from './constants.js';

export interface BrowserArguments {
  autoConnect: boolean;
  browserUrl?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  headless: boolean;
  executablePath?: string;
  isolated: boolean;
  userDataDir?: string;
  channel?: ChannelInput;
  proxyServer?: string;
  chromeArg?: string[];
  ignoreDefaultChromeArg?: string[];
  cloak: boolean;
  minimalStealth: boolean;
  fullStealthArgs: boolean;
  jsStealth: boolean;
}

export type BrowserOptions = ConfigOptionsFor<BrowserArguments, ConfigOption>;

export const browserOptions: BrowserOptions = {
  autoConnect: {
    type: 'boolean',
    describe: '自动连接到本地运行中的 Chrome 实例 (Chrome 144+)',
    default: false,
    envKey: 'BROWSER_AUTO_CONNECT',
    browserKey: 'autoConnect',
  },
  browserUrl: {
    type: 'string',
    describe: '连接运行中的 Chrome 远程调试地址（如 http://127.0.0.1:9222）',
    alias: 'u',
    envKey: 'BROWSER_URL',
    browserKey: 'browserURL',
    coerce: (url: string | undefined): string | undefined => {
      if (!url) {
        return undefined;
      }
      try {
        new URL(url);
      } catch {
        throw new Error(`Provided browserUrl ${url} is not valid URL.`);
      }
      return url;
    },
  },
  wsEndpoint: {
    type: 'string',
    describe:
      'WebSocket 端点地址（如 ws://127.0.0.1:9222/devtools/browser/...）',
    alias: 'w',
    envKey: 'BROWSER_WS_ENDPOINT',
    browserKey: 'wsEndpoint',
    coerce: (url: string | undefined): string | undefined => {
      if (!url) {
        return undefined;
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
          throw new Error(
            `Provided wsEndpoint ${url} must use ws:// or wss:// protocol.`,
          );
        }
        return url;
      } catch (error) {
        if ((error as Error).message.includes('ws://')) {
          throw error;
        }
        throw new Error(`Provided wsEndpoint ${url} is not valid URL.`);
      }
    },
  },
  wsHeaders: {
    type: 'string',
    describe: 'WebSocket 连接自定义请求头（JSON 对象）',
    envKey: 'BROWSER_WS_HEADERS',
    browserKey: 'wsHeaders',
    coerce: (val: unknown): Record<string, string> | undefined => {
      if (!val) {
        return undefined;
      }
      try {
        const parsed: unknown = typeof val === 'string' ? JSON.parse(val) : val;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error('Headers must be a JSON object');
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== 'string') {
            throw new Error(`Header "${key}" must have a string value`);
          }
          headers[key] = value;
        }
        return headers;
      } catch (error) {
        throw new Error(
          `Invalid JSON for wsHeaders: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  },
  headless: {
    type: 'boolean',
    describe: '以无头模式运行浏览器',
    default: false,
    envKey: 'BROWSER_HEADLESS',
    browserKey: 'headless',
  },
  executablePath: {
    type: 'string',
    describe: '本地自定义浏览器可执行文件路径',
    alias: 'e',
    envKey: 'BROWSER_EXECUTABLE_PATH',
    browserKey: 'executablePath',
  },
  isolated: {
    type: 'boolean',
    describe: '创建临时 user-data-dir，退出后清理',
    default: false,
    envKey: 'BROWSER_ISOLATED',
    browserKey: 'isolated',
  },
  userDataDir: {
    type: 'string',
    describe: '指定 Chrome 用户数据目录',
    envKey: 'BROWSER_USER_DATA_DIR',
    browserKey: 'userDataDir',
  },
  channel: {
    type: 'string',
    describe:
      '本地启动浏览器渠道（stable, beta, dev, canary, chrome, firefox 等）',
    choices: CHANNELS,
    default: 'stable',
    envKey: 'BROWSER_CHANNEL',
    browserKey: 'channel',
  },
  proxyServer: {
    type: 'string',
    describe: '代理服务器配置',
    envKey: 'BROWSER_PROXY_SERVER',
    browserKey: 'proxyServer',
  },
  chromeArg: {
    type: 'array',
    string: true,
    describe: '传递给 Chrome 启动进程的附加参数',
    browserKey: 'chromeArg',
  },
  ignoreDefaultChromeArg: {
    type: 'array',
    string: true,
    describe: '禁用指定的 Chrome 默认参数',
    browserKey: 'ignoreDefaultChromeArg',
  },
  cloak: {
    type: 'boolean',
    describe: '启用 CloakBrowser 源码级反检测二进制',
    default: false,
    envKey: 'BROWSER_CLOAK',
    browserKey: 'cloak',
  },
  minimalStealth: {
    type: 'boolean',
    describe: '启用最小反检测启动参数',
    default: true,
    envKey: 'BROWSER_MINIMAL_STEALTH',
    browserKey: 'minimalStealth',
  },
  fullStealthArgs: {
    type: 'boolean',
    describe: '启用全量隐身启动参数',
    default: false,
    envKey: 'BROWSER_FULL_STEALTH_ARGS',
    browserKey: 'fullStealthArgs',
  },
  jsStealth: {
    type: 'boolean',
    describe: '注入 StealthScripts2025 JS 脚本',
    default: false,
    envKey: 'BROWSER_JS_STEALTH',
    browserKey: 'jsStealth',
  },
};

export function getBrowserOptions(): BrowserOptions {
  return browserOptions;
}
