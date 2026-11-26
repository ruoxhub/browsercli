/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 服务端/CLI 统一选项定义（参考 chrome-devtools-mcp/src/config/mcp-options.ts）。
 */

import os from 'node:os';
import path from 'node:path';

import type {YargsOptions} from '../third_party/index.js';

import {type BrowserArguments, getBrowserOptions} from './browser-options.js';
import {
  type CategoryArguments,
  type ConfigOption,
  type ConfigOptionsFor,
  getCategoryOptions,
} from './category-options.js';
import {CHANNELS, type ChannelInput, RUNTIME_DIR_NAME} from './constants.js';
import {type RuntimeArguments, runtimeOptions} from './runtime-options.js';
import {
  type BrowserConfig,
  BrowserConfigSchema,
  type ToolResultRecordingConfig,
  ToolResultRecordingConfigSchema,
} from './schema.js';
import {type ToolArguments, toolOptions} from './tool-options.js';

export {CHANNELS, type ChannelInput};

export interface ServerArguments
  extends CategoryArguments, BrowserArguments, RuntimeArguments, ToolArguments {
  logFile?: string;
  pageIdRouting: boolean;
  experimentalDevtools: boolean;
  experimentalVision: boolean;
  memoryDebugging: boolean;
  experimentalIncludeAllPages: boolean;
  experimentalScreencast: boolean;
  experimentalFfmpegPath?: string;
  screencastFps?: number;
  performanceCrux: boolean;
  usageStatistics: boolean;
  javascriptEvaluation: boolean;
  fileNavigations: boolean;
  sourceMaps: boolean;
  maxNavigationSaved: number;
  redactNetworkHeaders: boolean;
  allowUnrestrictedPaths: boolean;
  filesystemRoot?: string[];
  viaCli: boolean;
  config?: string;
  watchConfig: boolean;
  runtimeDirName: string;
  debug: boolean;
  logLevel?: string;
  outputDir?: string;
  toolResultRecording?: ToolResultRecordingConfig;
  browser?: BrowserConfig;
}

export type ParsedArguments = {
  [K in keyof ServerArguments]: ServerArguments[K];
};

export type ServerOptions = ConfigOptionsFor<ParsedArguments, ConfigOption>;

export const DEFAULT_FILESYSTEM_ROOT: string[] = [os.tmpdir()];
export const DEFAULT_MAX_NAVIGATION_SAVED = 3;
export const MAX_NAVIGATION_SAVED_LIMIT = 25;

function parseObjectOption<T>(
  raw: unknown,
  label: string,
  parse: (value: unknown) => T,
): T | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parse(value);
}

export const serverOptions: ServerOptions = {
  ...getCategoryOptions(),
  ...getBrowserOptions(),
  ...runtimeOptions,
  ...toolOptions,
  logFile: {
    type: 'string',
    describe: '调试日志写入文件路径',
    browserKey: 'logFile',
  },
  pageIdRouting: {
    type: 'boolean',
    describe:
      'Require pageId on page-scoped tools and route requests by page ID.',
    default: true,
    reloadable: true,
  },
  experimentalDevtools: {
    type: 'boolean',
    default: false,
    describe: '启用 DevTools Target 操作',
    browserKey: 'experimentalDevtools',
  },
  experimentalVision: {
    type: 'boolean',
    default: false,
    describe: '启用基于坐标的视觉工具',
    reloadable: true,
    browserKey: 'experimentalVision',
  },
  memoryDebugging: {
    type: 'boolean',
    default: false,
    hidden: true,
    alias: 'experimentalMemory',
    describe: '启用内存调试工具',
    reloadable: true,
    browserKey: 'memoryDebugging',
  },
  experimentalIncludeAllPages: {
    type: 'boolean',
    default: false,
    describe: '包含全部页面/webview',
    reloadable: true,
    browserKey: 'experimentalIncludeAllPages',
  },
  experimentalScreencast: {
    type: 'boolean',
    default: false,
    describe: '启用录屏功能',
    reloadable: true,
    browserKey: 'experimentalScreencast',
  },
  experimentalFfmpegPath: {
    type: 'string',
    hidden: true,
    describe: '自定义 ffmpeg 可执行文件路径',
    browserKey: 'experimentalFfmpegPath',
  },
  screencastFps: {
    type: 'number',
    alias: 'experimentalScreencastFps',
    describe: '录屏帧率',
    reloadable: true,
    browserKey: 'screencastFps',
    coerce: (value: number | undefined): number | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
          `Invalid screencastFps ${value}. Expected a positive integer.`,
        );
      }
      return value;
    },
  },
  performanceCrux: {
    type: 'boolean',
    default: true,
    hidden: true,
    describe: '启用 CrUX 性能数据集成',
    reloadable: true,
    browserKey: 'performanceCrux',
  },
  usageStatistics: {
    type: 'boolean',
    default: true,
    hidden: true,
    describe: '是否允许发送匿名使用统计',
    browserKey: 'usageStatistics',
  },
  javascriptEvaluation: {
    type: 'boolean',
    default: true,
    describe: '允许执行自定义 JS',
    reloadable: true,
    browserKey: 'javascriptEvaluation',
  },
  fileNavigations: {
    type: 'boolean',
    default: true,
    describe: '允许导航到 file: URL',
    reloadable: true,
    browserKey: 'fileNavigations',
  },
  sourceMaps: {
    type: 'boolean',
    default: true,
    describe: '启用 DevTools source maps',
    reloadable: true,
    browserKey: 'sourceMaps',
  },
  maxNavigationSaved: {
    type: 'number',
    default: DEFAULT_MAX_NAVIGATION_SAVED,
    describe: `每个页面保留日志的导航次数（1-${MAX_NAVIGATION_SAVED_LIMIT}）`,
    browserKey: 'maxNavigationSaved',
    coerce: (value: number | undefined): number | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (
        !Number.isInteger(value) ||
        value <= 0 ||
        value > MAX_NAVIGATION_SAVED_LIMIT
      ) {
        throw new Error(
          `Invalid maxNavigationSaved ${value}. Expected an integer between 1 and ${MAX_NAVIGATION_SAVED_LIMIT}.`,
        );
      }
      return value;
    },
  },
  redactNetworkHeaders: {
    type: 'boolean',
    default: false,
    describe: '脱敏敏感网络请求头',
    reloadable: true,
    browserKey: 'redactNetworkHeaders',
  },
  allowUnrestrictedPaths: {
    type: 'boolean',
    default: false,
    describe: '解除受限工作区路径限制',
    reloadable: true,
    browserKey: 'allowUnrestrictedPaths',
  },
  filesystemRoot: {
    type: 'array',
    string: true,
    alias: 'workspace',
    default: DEFAULT_FILESYSTEM_ROOT,
    defaultDescription: 'OS temp directory',
    describe: '允许文件系统工具访问的目录',
    reloadable: true,
    browserKey: 'filesystemRoot',
  },
  viaCli: {
    type: 'boolean',
    default: false,
    hidden: true,
    describe: 'Mark that the daemon was launched via CLI client.',
  },
  config: {
    type: 'string',
    describe: '指定 JSON 配置文件路径',
    coerce: (configPath: string | undefined): string | undefined => {
      if (!configPath) {
        return undefined;
      }
      return path.resolve(configPath);
    },
  },
  watchConfig: {
    type: 'boolean',
    default: false,
    describe: '监听配置文件变更并热重载',
  },
  runtimeDirName: {
    type: 'string',
    default: RUNTIME_DIR_NAME,
    hidden: true,
    describe: 'Worker 运行时目录名称',
    envKey: 'BROWSER_RUNTIME_DIR',
  },
  debug: {
    type: 'boolean',
    default: false,
    hidden: true,
    describe: '启用调试日志',
    reloadable: true,
    envKey: 'BROWSER_DEBUG',
  },
  logLevel: {
    type: 'string',
    hidden: true,
    describe: '日志级别',
    reloadable: true,
    envKey: 'LOG_LEVEL',
  },
  outputDir: {
    type: 'string',
    hidden: true,
    describe: '默认产物输出目录',
    reloadable: true,
    envKey: 'BROWSER_OUTPUT_DIR',
  },
  toolResultRecording: {
    type: 'string',
    hidden: true,
    describe: '工具结果落盘记录配置',
    reloadable: true,
    coerce: (raw: unknown): ToolResultRecordingConfig | undefined =>
      parseObjectOption(raw, 'toolResultRecording', v =>
        ToolResultRecordingConfigSchema.parse(v),
      ),
  },
  browser: {
    type: 'string',
    hidden: true,
    describe: '嵌套浏览器配置对象',
    reloadable: false,
    coerce: (raw: unknown): BrowserConfig | undefined =>
      parseObjectOption(raw, 'browser', v => BrowserConfigSchema.parse(v)),
  },
};

export const serverOptionsForViaCli: ServerOptions = {
  ...serverOptions,
  headless: {
    ...serverOptions.headless,
    default: true,
  },
  categoryExtensions: {
    ...serverOptions.categoryExtensions,
    defaultDescription:
      'true unless autoConnect, browserUrl or wsEndpoint is set',
  },
  isolated: {
    ...serverOptions.isolated,
    defaultDescription:
      'true unless userDataDir, autoConnect, browserUrl or wsEndpoint is set',
  },
};

export function getCliOptions(): Partial<
  Record<keyof ServerOptions, YargsOptions>
> {
  const options: Partial<Record<keyof ServerOptions, YargsOptions>> =
    withoutDefaults(serverOptionsForViaCli);

  // Nested/internal daemon config keys are not exposed as CLI flags on `start`.
  delete options.browser;
  delete options.toolResultRecording;
  delete options.runtimeDirName;
  delete options.debug;
  delete options.logLevel;
  delete options.outputDir;
  delete options.viaCli;

  return options;
}

export const CLI_EXAMPLES: Array<[string, string]> = [
  [
    '$0 --browserUrl http://127.0.0.1:9222',
    'Connect to an existing browser instance via HTTP',
  ],
  [
    '$0 --wsEndpoint ws://127.0.0.1:9222/devtools/browser/abc123',
    'Connect to an existing browser instance via WebSocket',
  ],
  ['$0 --channel beta', 'Use Chrome Beta installed on this system'],
  ['$0 --no-headless', 'Launch browser in headed mode'],
  ['$0 --cloak', 'Launch CloakBrowser anti-detection binary'],
  [
    '$0 --config ./browsercli.config.json --watch-config',
    'Load and watch config file',
  ],
];

export const CONFLICTING_ARGS: ReadonlyArray<
  ReadonlyArray<keyof ServerOptions>
> = [
  ['channel', 'executablePath', 'browserUrl', 'wsEndpoint'],
  ['userDataDir', 'browserUrl', 'wsEndpoint'],
  ['userDataDir', 'isolated'],
  ['autoConnect', 'isolated'],
  ['autoConnect', 'executablePath'],
  ['blockedUrlPattern', 'allowedUrlPattern'],
  ['allowUnrestrictedPaths', 'filesystemRoot'],
  ['categoryPwa', 'autoConnect'],
  ['categoryPwa', 'browserUrl', 'wsEndpoint'],
];

export const IMPLICATIONS: ReadonlyArray<
  readonly [keyof ServerOptions, keyof ServerOptions]
> = [['wsHeaders', 'wsEndpoint']];

export function withoutDefaults(
  options: Record<string, YargsOptions>,
): Record<string, YargsOptions> {
  const result: Record<string, YargsOptions> = {};
  for (const [key, option] of Object.entries(options)) {
    const copy: YargsOptions = {...option};
    if (copy.default !== undefined) {
      copy.defaultDescription ??= JSON.stringify(copy.default);
      delete copy.default;
    }
    result[key] = copy;
  }
  return result;
}

export function stripYargsPositionalArgs<T extends {_?: unknown; $0?: unknown}>(
  parsed: T,
): {
  [K in keyof T as string extends K
    ? never
    : K extends '_' | '$0'
      ? never
      : K]: T[K];
} {
  const copy = {...parsed};
  delete copy._;
  delete copy.$0;
  return copy;
}

const RELOADABLE_KEYS: ReadonlySet<keyof ServerOptions> = new Set(
  (Object.entries(serverOptions) as Array<[keyof ServerOptions, ConfigOption]>)
    .filter(([, meta]) => meta.reloadable === true)
    .map(([key]) => key),
);

export function isReloadableOption(name: keyof ServerOptions): boolean {
  return RELOADABLE_KEYS.has(name);
}

export function getReloadableOptionKeys(): ReadonlySet<keyof ServerOptions> {
  return RELOADABLE_KEYS;
}

function isOptionActive(value: unknown): boolean {
  return value !== undefined && value !== false;
}

/**
 * 校验显式输入中的互斥参数冲突。仅检查显式传入的激活值，默认值不会触发冲突。
 */
export function validateConfigConflicts(
  explicitArgs: Record<string, unknown>,
): void {
  const activeArgs = new Set<string>();
  for (const [key, val] of Object.entries(explicitArgs)) {
    if (isOptionActive(val)) {
      activeArgs.add(key);
    }
  }
  if (activeArgs.has('workspace')) {
    activeArgs.add('filesystemRoot');
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
  explicitArgs: Record<string, unknown>,
): void {
  for (const [key, implied] of IMPLICATIONS) {
    if (
      isOptionActive(explicitArgs[key]) &&
      !isOptionActive(explicitArgs[implied])
    ) {
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

/**
 * 返回所有已知顶层配置键及别名集合（用于严格模式识别未知键）。
 */
export function getKnownConfigKeys(): Set<string> {
  const keys = new Set<string>(Object.keys(serverOptions));
  for (const option of Object.values(serverOptions) as ConfigOption[]) {
    if (!option.alias) continue;
    const aliases = Array.isArray(option.alias) ? option.alias : [option.alias];
    for (const alias of aliases) {
      keys.add(alias);
    }
  }
  return keys;
}
