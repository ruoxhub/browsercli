/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置选项元数据单一事实来源（参考 chrome-devtools-mcp/src/config/*-options.ts）。
 *
 * 集中声明：
 * - 所有顶层配置选项的类型、CLI 别名、环境变量映射、BrowserConfig 对应键
 * - 热重载能力标记（reloadable: true 表示修改配置文件无需重启 daemon）
 * - 互斥冲突组（CONFLICTING_ARGS）与依赖蕴含规则（IMPLICATIONS）
 * - 支持的浏览器 channel 枚举列表
 */

import os from 'node:os';

import {CHANNELS, type ChannelInput} from './constants.js';
import type {BrowserConfig, GlobalConfig} from './schema.js';

export {CHANNELS, type ChannelInput};

export const DEFAULT_FILESYSTEM_ROOT: string[] = [os.tmpdir()];
export const MAX_NAVIGATION_SAVED_LIMIT = 25;

export type ConfigOptionValueType = 'boolean' | 'string' | 'number' | 'array' | 'object';

export interface ConfigOptionMeta {
  type: ConfigOptionValueType;
  describe?: string;
  alias?: string | readonly string[];
  choices?: readonly string[];
  hidden?: boolean;
  /** 修改配置文件后是否支持热重载生效（无需重启 daemon）。 */
  reloadable?: boolean;
  /** 对应环境变量名（若有）。 */
  envKey?: string;
  /** 对应 `BrowserConfig` 字段名（若该项同时作用于浏览器配置）。 */
  browserKey?: keyof BrowserConfig;
}

/**
 * 所有已知顶层 CLI / 配置文件选项的统一元数据表。
 * 与 `GlobalConfigSchema` 保持一致，供 `ServerConfig`、`WorkerArgs`、`startOptions` 共享。
 */
export const CONFIG_OPTIONS: Partial<Record<keyof GlobalConfig, ConfigOptionMeta>> = {
  // ---- 浏览器连接与启动（均需重启） ----
  autoConnect: {
    type: 'boolean',
    describe: '自动连接到本地运行中的 Chrome 实例 (Chrome 144+)',
    envKey: 'BROWSER_AUTO_CONNECT',
    browserKey: 'autoConnect',
  },
  browserUrl: {
    type: 'string',
    alias: 'u',
    describe: '连接运行中的 Chrome 远程调试地址（如 http://127.0.0.1:9222）',
    envKey: 'BROWSER_URL',
    browserKey: 'browserURL',
  },
  wsEndpoint: {
    type: 'string',
    alias: 'w',
    describe: 'WebSocket 端点地址（如 ws://127.0.0.1:9222/devtools/browser/...）',
    envKey: 'BROWSER_WS_ENDPOINT',
    browserKey: 'wsEndpoint',
  },
  wsHeaders: {
    type: 'object',
    describe: 'WebSocket 连接自定义请求头（JSON 对象）',
    envKey: 'BROWSER_WS_HEADERS',
    browserKey: 'wsHeaders',
  },
  headless: {
    type: 'boolean',
    describe: '以无头模式运行浏览器',
    envKey: 'BROWSER_HEADLESS',
    browserKey: 'headless',
  },
  executablePath: {
    type: 'string',
    alias: 'e',
    describe: '本地自定义浏览器可执行文件路径',
    envKey: 'BROWSER_EXECUTABLE_PATH',
    browserKey: 'executablePath',
  },
  isolated: {
    type: 'boolean',
    describe: '创建临时 user-data-dir，退出后清理',
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
    describe: '本地启动浏览器渠道（stable, beta, dev, canary, chrome, firefox 等）',
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
    describe: '传递给 Chrome 启动进程的附加参数',
    browserKey: 'chromeArg',
  },
  ignoreDefaultChromeArg: {
    type: 'array',
    describe: '禁用指定的 Chrome 默认参数',
    browserKey: 'ignoreDefaultChromeArg',
  },
  acceptInsecureCerts: {
    type: 'boolean',
    describe: '忽略自签名和过期证书错误',
    envKey: 'BROWSER_ACCEPT_INSECURE_CERTS',
    browserKey: 'acceptInsecureCerts',
  },

  // ---- BrowserCLI 反检测选项（均需重启） ----
  cloak: {
    type: 'boolean',
    describe: '启用 CloakBrowser 源码级反检测二进制',
    envKey: 'BROWSER_CLOAK',
    browserKey: 'cloak',
  },
  minimalStealth: {
    type: 'boolean',
    describe: '启用最小反检测启动参数',
    envKey: 'BROWSER_MINIMAL_STEALTH',
    browserKey: 'minimalStealth',
  },
  fullStealthArgs: {
    type: 'boolean',
    describe: '启用全量隐身启动参数',
    envKey: 'BROWSER_FULL_STEALTH_ARGS',
    browserKey: 'fullStealthArgs',
  },
  jsStealth: {
    type: 'boolean',
    describe: '注入 StealthScripts2025 JS 脚本',
    envKey: 'BROWSER_JS_STEALTH',
    browserKey: 'jsStealth',
  },

  // ---- 工具分类开关（除 categoryExtensions 外均支持热重载） ----
  categoryInput: {
    type: 'boolean',
    describe: '启用/禁用输入相关工具',
    reloadable: true,
  },
  categoryNavigation: {
    type: 'boolean',
    describe: '启用/禁用导航相关工具',
    reloadable: true,
  },
  categoryEmulation: {
    type: 'boolean',
    describe: '启用/禁用仿真相关工具',
    reloadable: true,
  },
  categoryPerformance: {
    type: 'boolean',
    describe: '启用/禁用性能相关工具',
    reloadable: true,
  },
  categoryNetwork: {
    type: 'boolean',
    describe: '启用/禁用网络相关工具',
    reloadable: true,
  },
  categoryDebugging: {
    type: 'boolean',
    describe: '启用/禁用调试相关工具',
    reloadable: true,
  },
  categoryExtensions: {
    type: 'boolean',
    describe: '启用/禁用扩展相关工具',
    reloadable: false,
  },
  categoryExperimentalThirdParty: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
  },
  categoryMemory: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
  },
  categoryExperimentalWebmcp: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
  },
  categoryPwa: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
  },

  // ---- 截图与视觉（全部支持热重载） ----
  screenshotFormat: {
    type: 'string',
    choices: ['jpeg', 'png', 'webp'],
    describe: '默认截图格式',
    reloadable: true,
    browserKey: 'screenshotFormat',
  },
  screenshotQuality: {
    type: 'number',
    describe: '截图压缩质量（0-100）',
    reloadable: true,
    browserKey: 'screenshotQuality',
  },
  screenshotMaxWidth: {
    type: 'number',
    describe: '截图最大宽度（px）',
    reloadable: true,
    browserKey: 'screenshotMaxWidth',
  },
  screenshotMaxHeight: {
    type: 'number',
    describe: '截图最大高度（px）',
    reloadable: true,
    browserKey: 'screenshotMaxHeight',
  },
  experimentalVision: {
    type: 'boolean',
    describe: '启用基于坐标的视觉工具',
    reloadable: true,
    browserKey: 'experimentalVision',
  },

  // ---- 网络限制、安全与调试 ----
  blockedUrlPattern: {
    type: 'array',
    describe: '阻止指定 URL Pattern',
    reloadable: true,
    browserKey: 'blockedUrlPattern',
  },
  allowedUrlPattern: {
    type: 'array',
    describe: '仅允许指定 URL Pattern',
    reloadable: true,
    browserKey: 'allowedUrlPattern',
  },
  redactNetworkHeaders: {
    type: 'boolean',
    describe: '脱敏敏感网络请求头',
    reloadable: true,
    browserKey: 'redactNetworkHeaders',
  },
  maxNavigationSaved: {
    type: 'number',
    describe: '每个页面保留日志的导航次数',
    browserKey: 'maxNavigationSaved',
  },
  logFile: {
    type: 'string',
    describe: '调试日志写入文件路径',
    browserKey: 'logFile',
  },
  experimentalDevtools: {
    type: 'boolean',
    describe: '启用 DevTools Target 操作',
    browserKey: 'experimentalDevtools',
  },
  memoryDebugging: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
    browserKey: 'memoryDebugging',
  },
  experimentalMemory: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
    browserKey: 'experimentalMemory',
  },
  experimentalIncludeAllPages: {
    type: 'boolean',
    describe: '包含全部页面/webview',
    reloadable: true,
    browserKey: 'experimentalIncludeAllPages',
  },
  experimentalScreencast: {
    type: 'boolean',
    describe: '启用录屏功能',
    reloadable: true,
    browserKey: 'experimentalScreencast',
  },
  experimentalFfmpegPath: {
    type: 'string',
    hidden: true,
    browserKey: 'experimentalFfmpegPath',
  },
  screencastFps: {
    type: 'number',
    describe: '录屏帧率',
    reloadable: true,
    browserKey: 'screencastFps',
  },
  experimentalScreencastFps: {
    type: 'number',
    hidden: true,
    reloadable: true,
    browserKey: 'experimentalScreencastFps',
  },
  performanceCrux: {
    type: 'boolean',
    hidden: true,
    reloadable: true,
    browserKey: 'performanceCrux',
  },
  usageStatistics: {
    type: 'boolean',
    hidden: true,
    browserKey: 'usageStatistics',
  },
  javascriptEvaluation: {
    type: 'boolean',
    describe: '允许执行自定义 JS',
    reloadable: true,
    browserKey: 'javascriptEvaluation',
  },
  fileNavigations: {
    type: 'boolean',
    describe: '允许导航到 file: URL',
    reloadable: true,
    browserKey: 'fileNavigations',
  },
  sourceMaps: {
    type: 'boolean',
    describe: '启用 DevTools source maps',
    reloadable: true,
    browserKey: 'sourceMaps',
  },

  // ---- 文件系统、工作区与通用运行配置 ----
  allowUnrestrictedPaths: {
    type: 'boolean',
    describe: '解除受限工作区路径限制',
    reloadable: true,
    browserKey: 'allowUnrestrictedPaths',
  },
  workspace: {
    type: 'array',
    describe: '允许文件系统工具访问的目录',
    reloadable: true,
    browserKey: 'workspace',
  },
  filesystemRoot: {
    type: 'array',
    describe: '允许文件系统工具访问的目录',
    reloadable: true,
    browserKey: 'filesystemRoot',
  },
  runtimeDirName: {
    type: 'string',
    envKey: 'BROWSER_RUNTIME_DIR',
  },
  debug: {
    type: 'boolean',
    envKey: 'BROWSER_DEBUG',
    reloadable: true,
  },
  logLevel: {
    type: 'string',
    envKey: 'LOG_LEVEL',
    reloadable: true,
  },
  outputDir: {
    type: 'string',
    envKey: 'BROWSER_OUTPUT_DIR',
    reloadable: true,
  },
  toolResultRecording: {
    type: 'object',
    reloadable: true,
  },
  browser: {
    type: 'object',
    reloadable: false,
  },
  config: {
    type: 'string',
    describe: '指定 JSON 配置文件路径',
  },
  watchConfig: {
    type: 'boolean',
    describe: '监听配置文件变更并热重载',
  },
};

/** 互斥参数组：同一组内最多允许一个显式激活项（非 undefined 且非 false）。 */
export const CONFLICTING_ARGS: ReadonlyArray<ReadonlyArray<keyof GlobalConfig>> = [
  ['channel', 'executablePath', 'browserUrl', 'wsEndpoint'],
  ['userDataDir', 'browserUrl', 'wsEndpoint'],
  ['userDataDir', 'isolated'],
  ['autoConnect', 'isolated'],
  ['autoConnect', 'executablePath'],
  ['blockedUrlPattern', 'allowedUrlPattern'],
  ['allowUnrestrictedPaths', 'filesystemRoot'],
  ['allowUnrestrictedPaths', 'workspace'],
  ['categoryPwa', 'autoConnect'],
  ['categoryPwa', 'browserUrl', 'wsEndpoint'],
];

/** 蕴含规则：[key, implied] 表示当 key 显式激活时，implied 也必须显式激活。 */
export const IMPLICATIONS: ReadonlyArray<
  readonly [keyof GlobalConfig, keyof GlobalConfig]
> = [['wsHeaders', 'wsEndpoint']];

const RELOADABLE_KEYS: ReadonlySet<keyof GlobalConfig> = new Set(
  (Object.entries(CONFIG_OPTIONS) as Array<[keyof GlobalConfig, ConfigOptionMeta]>)
    .filter(([, meta]) => meta.reloadable === true)
    .map(([key]) => key),
);

export function isReloadableOption(key: keyof GlobalConfig): boolean {
  return RELOADABLE_KEYS.has(key);
}

export function getReloadableOptionKeys(): ReadonlySet<keyof GlobalConfig> {
  return RELOADABLE_KEYS;
}

function isOptionActive(value: unknown): boolean {
  return value !== undefined && value !== false;
}

/**
 * 校验显式输入中的互斥参数冲突。仅检查显式传入的激活值，默认值不会触发冲突。
 */
export function validateConfigConflicts(
  explicitArgs: Partial<GlobalConfig>,
): void {
  const activeArgs = new Set<string>();
  for (const [key, val] of Object.entries(explicitArgs)) {
    if (isOptionActive(val)) {
      activeArgs.add(key);
    }
  }
  for (const group of CONFLICTING_ARGS) {
    const activeInGroup = group.filter(arg => activeArgs.has(arg));
    if (activeInGroup.length > 1) {
      const [arg1, arg2] = activeInGroup;
      throw new Error(
        `Arguments ${String(arg1)} and ${String(arg2)} are mutually exclusive`,
      );
    }
  }
}

/**
 * 校验显式输入中的依赖蕴含规则（例如 `wsHeaders -> wsEndpoint`）。
 */
export function validateConfigImplications(
  explicitArgs: Partial<GlobalConfig>,
): void {
  for (const [key, implied] of IMPLICATIONS) {
    if (isOptionActive(explicitArgs[key]) && !isOptionActive(explicitArgs[implied])) {
      throw new Error(
        `Implications failed:\n  ${String(key)} -> ${String(implied)}`,
      );
    }
  }
}

/**
 * 将 camelCase 选项名转为 kebab-case CLI flag（如 `browserUrl` -> `browser-url`）。
 */
export function toKebabCase(key: string): string {
  return key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}
