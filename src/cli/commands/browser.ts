/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

import {parseArgs} from '../args-parser.js';
import {toAxiError} from '../errors.js';
import {successOutput, tableOutput} from '../output.js';
import type {CliConfig} from '../sessionPaths.js';
import {loadCliConfig} from '../sessionPaths.js';
import type {WorkerContext} from '../types.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
  BrowserDisconnectOptions,
} from '../types.js';

export const BROWSER_LAUNCH_OR_CONNECT_FLAGS = new Set([
  'u',
  'browser-url',
  'browserUrl',
  'w',
  'ws-endpoint',
  'wsEndpoint',
  'e',
  'executable-path',
  'executablePath',
  'auto-connect',
  'autoConnect',
  'channel',
  'user-data-dir',
  'userDataDir',
  'ws-headers',
  'wsHeaders',
  'viewport',
  'headless',
  'no-headless',
  'isolated',
  'no-isolated',
  'accept-insecure-certs',
  'acceptInsecureCerts',
  'cloak',
  'js-stealth',
  'jsStealth',
  'minimal-stealth',
  'minimalStealth',
  'full-stealth-args',
  'fullStealthArgs',
  'proxy-server',
  'proxyServer',
  'chrome-arg',
  'chromeArg',
  'ignore-default-chrome-arg',
  'ignoreDefaultChromeArg',
]);

export const CONNECT_FLAGS = new Set([
  ...BROWSER_LAUNCH_OR_CONNECT_FLAGS,
  'force',
  'json',

  // 工具分类开关 (Category flags)
  'category-input',
  'categoryInput',
  'no-category-input',
  'no-categoryInput',
  'category-navigation',
  'categoryNavigation',
  'no-category-navigation',
  'no-categoryNavigation',
  'category-emulation',
  'categoryEmulation',
  'no-category-emulation',
  'no-categoryEmulation',
  'category-performance',
  'categoryPerformance',
  'no-category-performance',
  'no-categoryPerformance',
  'category-network',
  'categoryNetwork',
  'no-category-network',
  'no-categoryNetwork',
  'category-debugging',
  'categoryDebugging',
  'no-category-debugging',
  'no-categoryDebugging',
  'category-extensions',
  'categoryExtensions',
  'no-category-extensions',
  'no-categoryExtensions',
  'category-experimental-third-party',
  'categoryExperimentalThirdParty',
  'category-memory',
  'categoryMemory',
  'no-category-memory',
  'no-categoryMemory',
  'category-experimental-webmcp',
  'categoryExperimentalWebmcp',
  'category-pwa',
  'categoryPwa',

  // 截图与视觉
  'screenshot-format',
  'screenshotFormat',
  'screenshot-quality',
  'screenshotQuality',
  'screenshot-max-width',
  'screenshotMaxWidth',
  'screenshot-max-height',
  'screenshotMaxHeight',
  'experimental-vision',
  'experimentalVision',

  // 调试与网络限制
  'blocked-url-pattern',
  'blockedUrlPattern',
  'allowed-url-pattern',
  'allowedUrlPattern',
  'redact-network-headers',
  'redactNetworkHeaders',
  'max-navigation-saved',
  'maxNavigationSaved',
  'log-file',
  'logFile',
  'experimental-devtools',
  'experimentalDevtools',
  'memory-debugging',
  'memoryDebugging',
  'experimental-memory',
  'experimentalMemory',
  'experimental-include-all-pages',
  'experimentalIncludeAllPages',
  'experimental-screencast',
  'experimentalScreencast',
  'experimental-ffmpeg-path',
  'experimentalFfmpegPath',
  'screencast-fps',
  'screencastFps',
  'experimental-screencast-fps',
  'experimentalScreencastFps',
  'performance-crux',
  'performanceCrux',
  'no-performance-crux',
  'no-performanceCrux',
  'usage-statistics',
  'usageStatistics',
  'no-usage-statistics',
  'no-usageStatistics',
  'javascript-evaluation',
  'javascriptEvaluation',
  'no-javascript-evaluation',
  'no-javascriptEvaluation',
  'file-navigations',
  'fileNavigations',
  'no-file-navigations',
  'no-fileNavigations',
  'source-maps',
  'sourceMaps',
  'no-source-maps',
  'no-sourceMaps',
  'allow-unrestricted-paths',
  'allowUnrestrictedPaths',
  'workspace',
  'filesystem-root',
  'filesystemRoot',
  'config',
  'watch-config',
  'watchConfig',
]);
const READ_FLAGS = new Set(['json']);
const DISCONNECT_FLAGS = new Set(['force', 'json']);
const CHANNELS = new Set([
  'stable',
  'beta',
  'dev',
  'canary',
  'chrome',
  'chrome-beta',
  'chrome-dev',
  'chrome-canary',
  'chromium',
  'bidi-chromium',
  'bidi-chrome',
  'bidi-chrome-beta',
  'bidi-chrome-dev',
  'bidi-chrome-canary',
  'firefox',
  'moz-firefox',
]);

interface ExtendedCliConfig extends CliConfig {
  autoConnect?: boolean | string;
  browserURL?: string;
  channel?: string;
  wsHeaders?: Record<string, string>;
  viewport?: {width: number; height: number};
  userDataDir?: string;
  acceptInsecureCerts?: boolean | string;
  isolated?: boolean | string;
  browser?: {
    autoConnect?: boolean | string;
    browserURL?: string;
    browserUrl?: string;
    wsEndpoint?: string;
    channel?: string;
    executablePath?: string;
    wsHeaders?: Record<string, string>;
    viewport?: {width: number; height: number};
    userDataDir?: string;
    headless?: boolean | string;
    cloak?: boolean | string;
    jsStealth?: boolean | string;
    minimalStealth?: boolean | string;
    fullStealthArgs?: boolean | string;
    isolated?: boolean | string;
    acceptInsecureCerts?: boolean | string;
  };
}

function invalid(message: string): never {
  throw new AxiError(message, 'VALIDATION_ERROR', [
    '用法：browsercli browser connect|disconnect|status [options]',
  ]);
}

function assertFlags(
  flags: Record<string, string | boolean>,
  allowed: Set<string>,
): void {
  const unknown = Object.keys(flags).find(key => !allowed.has(key));
  if (unknown) invalid(`未知参数：--${unknown}`);
}

function stringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  if (!(key in flags)) return undefined;
  const value = flags[key];
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`--${key} 缺少值`);
  }
  return value;
}

function parseBooleanValue(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function booleanFlag(
  flags: Record<string, string | boolean>,
  key: string,
): boolean | undefined {
  if (!(key in flags)) return undefined;
  const parsed = parseBooleanValue(flags[key]);
  if (parsed !== undefined) return parsed;
  return invalid(`--${key} 必须是 true 或 false`);
}

function normalizeTargetUrl(
  value: string,
  protocols: string[],
  sourceName: string,
): string {
  let normalized = value;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    normalized = protocols.includes('http:') ? `http://${value}` : value;
  }
  let protocol: string;
  try {
    protocol = new URL(normalized).protocol;
  } catch {
    return invalid(`${sourceName} 不是合法 URL`);
  }
  if (!protocols.includes(protocol)) {
    return invalid(`${sourceName} 必须使用 ${protocols.join(' 或 ')}`);
  }
  return normalized;
}

function urlFlag(
  flags: Record<string, string | boolean>,
  key: string,
  protocols: string[],
): string | undefined {
  const value = stringFlag(flags, key);
  if (value === undefined) return undefined;
  return normalizeTargetUrl(value, protocols, `--${key}`);
}

function findStringFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = stringFlag(flags, k);
    if (v !== undefined) return v;
  }
  return undefined;
}

function findUrlFlag(
  flags: Record<string, string | boolean>,
  protocols: string[],
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = urlFlag(flags, k, protocols);
    if (v !== undefined) return v;
  }
  return undefined;
}

function findBooleanFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): boolean | undefined {
  for (const k of keys) {
    if (k.startsWith('no-')) {
      const v = booleanFlag(flags, k);
      if (v !== undefined) return !v;
    } else {
      const v = booleanFlag(flags, k);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function findArrayFlag(
  flags: Record<string, string | boolean>,
  ...keys: string[]
): string[] | undefined {
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === 'string') {
      return v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  return undefined;
}

function headersFlag(
  flags: Record<string, string | boolean>,
): Record<string, string> | undefined {
  const raw = findStringFlag(flags, 'ws-headers', 'wsHeaders');
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('--ws-headers 必须是合法 JSON');
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some(item => typeof item !== 'string')
  ) {
    return invalid('--ws-headers 必须是字符串键值对象');
  }
  return value as Record<string, string>;
}

function viewportFlag(
  flags: Record<string, string | boolean>,
): {width: number; height: number} | undefined {
  const raw = stringFlag(flags, 'viewport');
  if (raw === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) return invalid('--viewport 格式必须为 宽x高');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1 || height < 1) return invalid('--viewport 宽高必须大于 0');
  return {width, height};
}

export function connectOptions(
  flags: Record<string, string | boolean>,
): BrowserConnectOptions {
  assertFlags(flags, CONNECT_FLAGS);
  let browserURL = findUrlFlag(
    flags,
    ['http:', 'https:'],
    'browser-url',
    'browserUrl',
    'u',
  );
  let wsEndpoint = findUrlFlag(
    flags,
    ['ws:', 'wss:'],
    'ws-endpoint',
    'wsEndpoint',
    'w',
  );
  let autoConnect = findBooleanFlag(flags, 'auto-connect', 'autoConnect');
  let channel = findStringFlag(flags, 'channel');
  let executablePath = findStringFlag(
    flags,
    'executable-path',
    'executablePath',
    'e',
  );

  const cliHasTarget =
    browserURL !== undefined ||
    wsEndpoint !== undefined ||
    autoConnect !== undefined ||
    channel !== undefined ||
    executablePath !== undefined;

  const envTargetUrl = process.env.BROWSER_URL;
  const envWsEndpoint = process.env.BROWSER_WS_ENDPOINT;
  const envAutoConnect = process.env.BROWSER_AUTO_CONNECT;
  const envChannel = process.env.BROWSER_CHANNEL;
  const envExecutablePath = process.env.BROWSER_EXECUTABLE_PATH;

  const envHasTarget =
    Boolean(envTargetUrl) ||
    Boolean(envWsEndpoint) ||
    Boolean(envAutoConnect) ||
    Boolean(envChannel) ||
    Boolean(envExecutablePath);

  const rawConfig = loadCliConfig() as ExtendedCliConfig;
  const nestedBrowser =
    rawConfig.browser &&
    typeof rawConfig.browser === 'object' &&
    !Array.isArray(rawConfig.browser)
      ? rawConfig.browser
      : undefined;

  if (!cliHasTarget) {
    if (envHasTarget) {
      if (envTargetUrl) {
        browserURL = normalizeTargetUrl(
          envTargetUrl,
          ['http:', 'https:'],
          'BROWSER_URL',
        );
      } else if (envWsEndpoint) {
        wsEndpoint = normalizeTargetUrl(
          envWsEndpoint,
          ['ws:', 'wss:'],
          'BROWSER_WS_ENDPOINT',
        );
      } else if (parseBooleanValue(envAutoConnect)) {
        autoConnect = true;
      } else if (envChannel) {
        channel = envChannel;
      } else if (envExecutablePath) {
        executablePath = envExecutablePath;
      }
    } else {
      const rawBrowserUrl =
        nestedBrowser?.browserURL ??
        nestedBrowser?.browserUrl ??
        rawConfig.browserUrl ??
        rawConfig.browserURL;
      const rawWsEndpoint = nestedBrowser?.wsEndpoint ?? rawConfig.wsEndpoint;
      const rawAutoConnect =
        nestedBrowser?.autoConnect ?? rawConfig.autoConnect;
      const rawExecutablePath =
        nestedBrowser?.executablePath ?? rawConfig.executablePath;
      const rawChannel = nestedBrowser?.channel ?? rawConfig.channel;

      if (rawBrowserUrl) {
        browserURL = normalizeTargetUrl(
          rawBrowserUrl,
          ['http:', 'https:'],
          'browserUrl',
        );
      } else if (rawWsEndpoint) {
        wsEndpoint = normalizeTargetUrl(
          rawWsEndpoint,
          ['ws:', 'wss:'],
          'wsEndpoint',
        );
      } else if (parseBooleanValue(rawAutoConnect)) {
        autoConnect = true;
      } else if (rawExecutablePath) {
        executablePath = rawExecutablePath;
      } else if (rawChannel) {
        channel = rawChannel;
      }
    }
  }

  const remote =
    browserURL !== undefined ||
    wsEndpoint !== undefined ||
    autoConnect === true;
  const local = channel !== undefined || executablePath !== undefined;
  if (
    (browserURL !== undefined && wsEndpoint !== undefined) ||
    (channel !== undefined && executablePath !== undefined) ||
    (remote && local)
  ) {
    invalid('连接目标参数互斥');
  }
  if (channel !== undefined && !CHANNELS.has(channel)) {
    invalid(`不支持的浏览器 channel：${channel}`);
  }

  const options: BrowserConnectOptions = {};
  if (browserURL !== undefined) options.browserURL = browserURL;
  if (wsEndpoint !== undefined) options.wsEndpoint = wsEndpoint;
  if (autoConnect !== undefined) options.autoConnect = autoConnect;
  if (channel !== undefined) options.channel = channel;
  if (executablePath !== undefined) options.executablePath = executablePath;

  let wsHeaders = headersFlag(flags);
  if (wsHeaders === undefined && process.env.BROWSER_WS_HEADERS) {
    try {
      wsHeaders = JSON.parse(
        process.env.BROWSER_WS_HEADERS.replace(/^\uFEFF/, ''),
      ) as Record<string, string>;
    } catch {
      // 忽略非法 JSON
    }
  }
  if (wsHeaders === undefined) {
    wsHeaders = nestedBrowser?.wsHeaders ?? rawConfig.wsHeaders;
  }

  const viewport =
    viewportFlag(flags) ?? nestedBrowser?.viewport ?? rawConfig.viewport;

  let userDataDir = findStringFlag(flags, 'user-data-dir', 'userDataDir');
  if (userDataDir === undefined) {
    userDataDir =
      process.env.BROWSER_USER_DATA_DIR ??
      nestedBrowser?.userDataDir ??
      rawConfig.userDataDir;
  }

  const proxyServer = findStringFlag(flags, 'proxy-server', 'proxyServer');
  const chromeArg = findArrayFlag(flags, 'chrome-arg', 'chromeArg');
  const ignoreDefaultChromeArg = findArrayFlag(
    flags,
    'ignore-default-chrome-arg',
    'ignoreDefaultChromeArg',
  );

  if (wsHeaders !== undefined) options.wsHeaders = wsHeaders;
  if (viewport !== undefined) options.viewport = viewport;
  if (userDataDir !== undefined) options.userDataDir = userDataDir;
  if (proxyServer !== undefined) options.proxyServer = proxyServer;
  if (chromeArg !== undefined) options.chromeArg = chromeArg;
  if (ignoreDefaultChromeArg !== undefined) {
    options.ignoreDefaultChromeArg = ignoreDefaultChromeArg;
  }

  const booleanKeys = [
    [
      'acceptInsecureCerts',
      ['accept-insecure-certs', 'acceptInsecureCerts'],
      'BROWSER_ACCEPT_INSECURE_CERTS',
    ],
    ['cloak', ['cloak'], 'BROWSER_CLOAK'],
    ['force', ['force'], ''],
    [
      'fullStealthArgs',
      ['full-stealth-args', 'fullStealthArgs'],
      'BROWSER_FULL_STEALTH_ARGS',
    ],
    ['headless', ['headless', 'no-headless'], 'BROWSER_HEADLESS'],
    ['isolated', ['isolated', 'no-isolated'], 'BROWSER_ISOLATED'],
    ['jsStealth', ['js-stealth', 'jsStealth'], 'BROWSER_JS_STEALTH'],
    [
      'minimalStealth',
      ['minimal-stealth', 'minimalStealth'],
      'BROWSER_MINIMAL_STEALTH',
    ],
  ] as const;

  for (const [prop, flagNames, envKey] of booleanKeys) {
    let val = findBooleanFlag(flags, ...flagNames);
    if (val === undefined && envKey && process.env[envKey] !== undefined) {
      val = parseBooleanValue(process.env[envKey]);
    }
    if (val === undefined) {
      val =
        parseBooleanValue(nestedBrowser?.[prop]) ??
        parseBooleanValue(rawConfig[prop]);
    }
    if (val !== undefined) {
      (options as Record<string, unknown>)[prop] = val;
    }
  }
  return options;
}

function renderBrowserStatus(
  action: 'connect' | 'disconnect' | 'status',
  state: BrowserConnectionStatus,
  json: boolean,
  session?: string,
) {
  const result = {command: 'browser', action, ...state};
  if (json) return successOutput(result, session);
  return {
    ...tableOutput(
      ['Property', 'Value'],
      [
        ['Connected', String(state.connected)],
        ['Mode', state.mode],
        ['Pages', String(state.pages)],
      ],
    ),
    ...(session !== undefined ? {session} : {}),
    ...result,
  };
}

export const browserCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const action = parsed.positionals[0];
  if (
    parsed.positionals.length !== 1 ||
    !['connect', 'disconnect', 'status'].includes(action)
  ) {
    invalid('浏览器动作必须是 connect、disconnect 或 status');
  }
  const typedAction = action as 'connect' | 'disconnect' | 'status';
  assertFlags(
    parsed.flags,
    typedAction === 'connect'
      ? CONNECT_FLAGS
      : typedAction === 'disconnect'
        ? DISCONNECT_FLAGS
        : READ_FLAGS,
  );
  const json = booleanFlag(parsed.flags, 'json') ?? false;
  const force =
    typedAction === 'disconnect'
      ? booleanFlag(parsed.flags, 'force')
      : undefined;
  const connectBody =
    typedAction === 'connect' ? connectOptions(parsed.flags) : undefined;
  const client = ctx ? await ctx.connect() : undefined;
  if (!client) throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');

  try {
    let state: BrowserConnectionStatus;
    if (typedAction === 'connect') {
      const startTime = Date.now();
      const retryTimeoutMs = 35_000;
      for (;;) {
        try {
          state = await client.request<BrowserConnectionStatus>(
            'browser.connect',
            {body: connectBody},
          );
          break;
        } catch (err) {
          if (
            err instanceof Error &&
            /WORKER_BUSY/.test(err.message) &&
            /browser connect/.test(err.message)
          ) {
            if (Date.now() - startTime < retryTimeoutMs) {
              await new Promise(r => setTimeout(r, 400));
              continue;
            }
            throw new Error(
              '[WORKER_BUSY] Worker 正在连接浏览器中（可能正在等待 Chrome 弹窗授权或网络连接响应）。\n' +
                '请留意 Chrome 界面顶部的 "Allow remote debugging" 弹窗，或稍后运行 "browsercli status" 查看连接结果。',
            );
          }
          throw err;
        }
      }
    } else if (typedAction === 'disconnect') {
      state = await client.request<BrowserConnectionStatus>(
        'browser.disconnect',
        force === undefined
          ? {body: {}}
          : {body: {force} satisfies BrowserDisconnectOptions},
      );
    } else {
      state = await client.request<BrowserConnectionStatus>('browser.status');
    }
    return renderBrowserStatus(typedAction, state, json, ctx?.session);
  } catch (error) {
    throw toAxiError(error, 'BROWSER_ERROR');
  } finally {
    client.close();
  }
};
