/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `browsercli start` 选项的单一事实来源（对齐 chrome-devtools-mcp 的 mcp-options + serializeArgs）：
 * 同时驱动 yargs 参数解析/help、daemon spawn flag 序列化与 browser.connect 配置校验。
 */

import type {Options} from 'yargs';

import {parseEnvBoolean} from '../config/browserInvariants.js';
import {CHANNELS} from '../config/constants.js';
import {getCliOptions, toKebabCase} from '../config/server-options.js';

import type {CliConfig} from './sessionPaths.js';
import type {BrowserConnectOptions} from './types.js';

export {CHANNELS};

const CHANNEL_SET = new Set<string>(CHANNELS);

function buildStartYargsOptions(): Record<string, Options> {
  const derived: Record<string, Options> = {};
  const deferredCoerceKeys = new Set([
    'browserUrl',
    'wsEndpoint',
    'wsHeaders',
    'viewport',
  ]);
  for (const [key, opt] of Object.entries(getCliOptions())) {
    if (!opt) continue;
    const copy: Options = {...opt};
    if (deferredCoerceKeys.has(key)) {
      delete copy.coerce;
    }
    derived[key] = copy;
  }

  return {
    ...derived,
    noConsole: {type: 'boolean', hidden: true},
    consolePort: {type: 'number', hidden: true},
    // 控制与输出
    force: {type: 'boolean', describe: '强制重新连接浏览器'},
    json: {type: 'boolean', describe: '以 JSON 格式输出结果'},
  };
}

export const START_YARGS_OPTIONS: Record<string, Options> =
  buildStartYargsOptions();

const BROWSER_CONNECT_KEYS = new Set([
  'browserUrl',
  'wsEndpoint',
  'wsHeaders',
  'autoConnect',
  'channel',
  'executablePath',
  'headless',
  'isolated',
  'userDataDir',
  'proxyServer',
  'chromeArg',
  'ignoreDefaultChromeArg',
  'acceptInsecureCerts',
  'viewport',
  'cloak',
  'minimalStealth',
  'fullStealthArgs',
  'jsStealth',
]);

/** 仅 CLI 侧消费、不透传给 daemon spawn 的选项 */
const NON_SPAWN_KEYS = new Set(['json', 'force', 'viewport']);

const CONFIG_BOOL_KEYS = [
  'headless',
  'cloak',
  'jsStealth',
  'fullStealthArgs',
  'minimalStealth',
] as const;

const CONFIG_VALUE_KEYS = [
  'browserUrl',
  'wsEndpoint',
  'executablePath',
] as const;

interface ExtendedCliConfig extends CliConfig {
  autoConnect?: boolean | string;
  browserURL?: string;
  channel?: string;
  wsHeaders?: Record<string, string>;
  viewport?: {width: number; height: number};
  userDataDir?: string;
  acceptInsecureCerts?: boolean | string;
  isolated?: boolean | string;
  browser?: Record<string, unknown>;
}

function parseBool(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return parseEnvBoolean(val);
  return undefined;
}

function normalizeUrl(
  raw: string,
  protocols: string[],
  source: string,
): string {
  const normalized =
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) && protocols.includes('http:')
      ? `http://${raw}`
      : raw;
  let protocol: string;
  try {
    protocol = new URL(normalized).protocol;
  } catch {
    throw new Error(`${source} 不是合法 URL`);
  }
  if (!protocols.includes(protocol)) {
    throw new Error(`${source} 必须使用 ${protocols.join(' 或 ')}`);
  }
  return normalized;
}

function parseStringArray(val: unknown): string[] | undefined {
  if (val === undefined) return undefined;
  const items = Array.isArray(val) ? val.map(String) : [String(val)];
  return items
    .flatMap(item => item.split(','))
    .map(s => s.trim())
    .filter(Boolean);
}

/** 将已解析的 yargs argv 序列化为 daemon spawn 参数，并回填 config.json 默认项。 */
export function serializeStartFlags(
  argv: Record<string, unknown>,
  config: CliConfig = {},
): string[] {
  const args: string[] = [];
  const present = new Set<string>();

  for (const key of Object.keys(START_YARGS_OPTIONS)) {
    if (NON_SPAWN_KEYS.has(key)) continue;
    const value = argv[key];
    if (value === undefined || value === null) continue;
    present.add(key);
    const kebab = toKebabCase(key);
    if (typeof value === 'boolean') {
      args.push(value ? `--${kebab}` : `--no-${kebab}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        args.push(`--${kebab}=${String(item)}`);
      }
    } else {
      const serialized =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      args.push(`--${kebab}=${serialized}`);
    }
  }

  for (const key of CONFIG_BOOL_KEYS) {
    if (!present.has(key) && config[key] === 'true') {
      args.push(`--${toKebabCase(key)}`);
    }
  }
  for (const key of CONFIG_VALUE_KEYS) {
    const val = config[key];
    if (!present.has(key) && val) {
      args.push(`--${key}=${val}`);
    }
  }
  return args;
}

/** 判断命令行是否显式传入了浏览器连接/启动参数。 */
export function hasExplicitBrowserFlags(
  argv: Record<string, unknown>,
): boolean {
  for (const key of BROWSER_CONNECT_KEYS) {
    if (argv[key] !== undefined) return true;
  }
  return false;
}

/** 构造并校验 `browser.connect` 请求体（优先级：CLI > env > config.json）。 */
export function buildBrowserConnectOptions(
  argv: Record<string, unknown>,
  rawConfigInput: CliConfig = {},
): BrowserConnectOptions {
  const rawConfig = rawConfigInput as ExtendedCliConfig;
  const nested =
    rawConfig.browser &&
    typeof rawConfig.browser === 'object' &&
    !Array.isArray(rawConfig.browser)
      ? rawConfig.browser
      : undefined;

  let browserURL =
    typeof argv.browserUrl === 'string'
      ? normalizeUrl(argv.browserUrl, ['http:', 'https:'], '--browserUrl')
      : undefined;
  let wsEndpoint =
    typeof argv.wsEndpoint === 'string'
      ? normalizeUrl(argv.wsEndpoint, ['ws:', 'wss:'], '--wsEndpoint')
      : undefined;
  let autoConnect = parseBool(argv.autoConnect);
  let channel = typeof argv.channel === 'string' ? argv.channel : undefined;
  let executablePath =
    typeof argv.executablePath === 'string' ? argv.executablePath : undefined;

  const cliHasTarget =
    browserURL !== undefined ||
    wsEndpoint !== undefined ||
    autoConnect !== undefined ||
    channel !== undefined ||
    executablePath !== undefined;

  if (!cliHasTarget) {
    if (process.env.BROWSER_URL) {
      browserURL = normalizeUrl(
        process.env.BROWSER_URL,
        ['http:', 'https:'],
        'BROWSER_URL',
      );
    } else if (process.env.BROWSER_WS_ENDPOINT) {
      wsEndpoint = normalizeUrl(
        process.env.BROWSER_WS_ENDPOINT,
        ['ws:', 'wss:'],
        'BROWSER_WS_ENDPOINT',
      );
    } else if (parseBool(process.env.BROWSER_AUTO_CONNECT)) {
      autoConnect = true;
    } else if (process.env.BROWSER_CHANNEL) {
      channel = process.env.BROWSER_CHANNEL;
    } else if (process.env.BROWSER_EXECUTABLE_PATH) {
      executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    } else {
      const cfgUrl =
        (nested?.browserURL as string | undefined) ??
        (nested?.browserUrl as string | undefined) ??
        rawConfig.browserUrl ??
        rawConfig.browserURL;
      const cfgWs =
        (nested?.wsEndpoint as string | undefined) ?? rawConfig.wsEndpoint;
      const cfgAuto = nested?.autoConnect ?? rawConfig.autoConnect;
      const cfgExe =
        (nested?.executablePath as string | undefined) ??
        rawConfig.executablePath;
      const cfgChannel =
        (nested?.channel as string | undefined) ?? rawConfig.channel;

      if (cfgUrl) {
        browserURL = normalizeUrl(cfgUrl, ['http:', 'https:'], 'browserUrl');
      } else if (cfgWs) {
        wsEndpoint = normalizeUrl(cfgWs, ['ws:', 'wss:'], 'wsEndpoint');
      } else if (parseBool(cfgAuto)) {
        autoConnect = true;
      } else if (cfgExe) {
        executablePath = cfgExe;
      } else if (cfgChannel) {
        channel = cfgChannel;
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
    throw new Error('连接目标参数互斥');
  }
  if (channel !== undefined && !CHANNEL_SET.has(channel)) {
    throw new Error(`不支持的浏览器 channel：${channel}`);
  }

  const options: BrowserConnectOptions = {};
  if (browserURL !== undefined) options.browserURL = browserURL;
  if (wsEndpoint !== undefined) options.wsEndpoint = wsEndpoint;
  if (autoConnect !== undefined) options.autoConnect = autoConnect;
  if (channel !== undefined) options.channel = channel;
  if (executablePath !== undefined) options.executablePath = executablePath;

  if (typeof argv.wsHeaders === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argv.wsHeaders);
    } catch {
      throw new Error('--ws-headers 必须是合法 JSON');
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.values(parsed).some(v => typeof v !== 'string')
    ) {
      throw new Error('--ws-headers 必须是字符串键值对象');
    }
    options.wsHeaders = parsed as Record<string, string>;
  } else if (process.env.BROWSER_WS_HEADERS) {
    try {
      options.wsHeaders = JSON.parse(
        process.env.BROWSER_WS_HEADERS.replace(/^\uFEFF/, ''),
      ) as Record<string, string>;
    } catch {
      // ignore invalid env json
    }
  } else {
    const cfgHeaders =
      (nested?.wsHeaders as Record<string, string> | undefined) ??
      rawConfig.wsHeaders;
    if (cfgHeaders !== undefined) options.wsHeaders = cfgHeaders;
  }

  if (typeof argv.viewport === 'string') {
    const m = /^(\d+)x(\d+)$/.exec(argv.viewport);
    if (!m) throw new Error('--viewport 格式必须为 宽x高');
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width < 1 || height < 1) throw new Error('--viewport 宽高必须大于 0');
    options.viewport = {width, height};
  } else {
    const cfgVp =
      (nested?.viewport as {width: number; height: number} | undefined) ??
      rawConfig.viewport;
    if (cfgVp !== undefined) options.viewport = cfgVp;
  }

  const userDataDir =
    (typeof argv.userDataDir === 'string' ? argv.userDataDir : undefined) ??
    process.env.BROWSER_USER_DATA_DIR ??
    (nested?.userDataDir as string | undefined) ??
    rawConfig.userDataDir;
  if (userDataDir !== undefined) options.userDataDir = userDataDir;
  if (typeof argv.proxyServer === 'string')
    options.proxyServer = argv.proxyServer;

  const chromeArg = parseStringArray(argv.chromeArg);
  if (chromeArg !== undefined) options.chromeArg = chromeArg;
  const ignoreDefaultChromeArg = parseStringArray(argv.ignoreDefaultChromeArg);
  if (ignoreDefaultChromeArg !== undefined) {
    options.ignoreDefaultChromeArg = ignoreDefaultChromeArg;
  }

  const boolFields = [
    ['acceptInsecureCerts', 'BROWSER_ACCEPT_INSECURE_CERTS'],
    ['cloak', 'BROWSER_CLOAK'],
    ['force', ''],
    ['fullStealthArgs', 'BROWSER_FULL_STEALTH_ARGS'],
    ['headless', 'BROWSER_HEADLESS'],
    ['isolated', 'BROWSER_ISOLATED'],
    ['jsStealth', 'BROWSER_JS_STEALTH'],
    ['minimalStealth', 'BROWSER_MINIMAL_STEALTH'],
  ] as const;

  for (const [prop, envKey] of boolFields) {
    let val = parseBool(argv[prop]);
    if (val === undefined && envKey && process.env[envKey] !== undefined) {
      val = parseBool(process.env[envKey]);
    }
    if (val === undefined) {
      val = parseBool(nested?.[prop]) ?? parseBool(rawConfig[prop]);
    }
    if (val !== undefined) {
      (options as Record<string, unknown>)[prop] = val;
    }
  }

  return options;
}
