/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 全局统一配置 — 整合 CLI 配置、全局配置文件、AI/Browser 系统配置
 *
 * 配置优先级（高 → 低）：
 * 1. CLI 参数（--rpcHost 等）
 * 2. 环境变量（RPC_HOST, OPENAI_API_KEY 等）
 * 3. 项目根目录配置文件（<cwd>/config.json）
 * 4. 项目级配置文件（<cwd>/js-reverse.config.json）
 * 5. 用户级配置文件（~/.jsreverse/config.json）
 * 6. 内置默认值
 *
 * 本文件合并了原先分散在以下三处的配置逻辑：
 * - src/cli/global-config.ts（全局配置文件加载/解析）
 * - src/cli/config.ts（CLI 常量 + 重新导出）
 * - src/utils/config.ts（.env 加载、AI/Browser 系统配置）
 */

import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {config as dotenvConfig} from 'dotenv';

import type {BrowserManagerConfig} from '../browser/browser.js';
import {AIService} from '../services/AIService.js';
import {OpenAIProvider} from '../services/OpenAIProvider.js';
import {resolveDefaultEnvPath} from '../utils/projectPaths.js';

import {
  DEFAULT_GROUP,
  DEFAULT_RPC_HOST,
  PROJECT_CONFIG_FILENAME,
  ROOT_CONFIG_FILENAME,
  RUNTIME_DIR_NAME,
  USER_CONFIG_DIR_NAME,
  USER_CONFIG_FILENAME,
} from './constants.js';
import {
  type AIConfig,
  type GlobalConfig,
  type SystemConfig,
  SystemConfigSchema,
  formatConfigValidationError,
  validateGlobalConfig,
  validateSystemConfig,
} from './schema.js';

// ==================== .env 加载 ====================

const envPath = resolveDefaultEnvPath(import.meta.url);
if (existsSync(envPath)) {
  dotenvConfig({path: envPath});
}

// ==========================================================================
// 第一部分：常量与默认值
// ==========================================================================

// ==========================================================================
// 第二部分：类型定义
// ==========================================================================

/** LLM 提供商类型 */
export type LLMProvider = GlobalConfig['llmProvider'] & string;

/** 用户级全局配置结构（配置文件可写的所有字段） */
export type {GlobalConfig};

/** AI Service 配置（运行时解析后的完整结构） */
export type {AIConfig};

/** 系统配置（AI + Browser + Debug） */
export type {SystemConfig};

/** 配置来源标记 */
export interface ConfigSource {
  /** 配置文件路径 */
  filePath: string;
  /** 是否存在 */
  exists: boolean;
  /** 加载的配置（仅 exists=true 时有值） */
  config?: GlobalConfig;
}

/** CLI 层解析后的完整配置 */
export interface ResolvedConfig {
  rpcHost: string;
  group: string;
  browserUrl?: string;
  wsEndpoint?: string;
  headless: boolean;
  executablePath?: string;
  databaseUrl?: string;
  runtimeDirName: string;
  debug: boolean;
}

export interface ResolvedToolResultRecordingConfig {
  enabled: boolean;
  outputDir: string;
}

/** 内置默认值 */
const DEFAULTS: Readonly<ResolvedConfig> = {
  rpcHost: DEFAULT_RPC_HOST,
  group: DEFAULT_GROUP,
  headless: false,
  runtimeDirName: RUNTIME_DIR_NAME,
  debug: false,
} as const;

// ==========================================================================
// 第三部分：全局配置文件管理（~/.jsreverse/config.json + js-reverse.config.json）
// ==========================================================================

/** 获取用户级配置文件路径 (~/.jsreverse/config.json) */
export function getUserConfigPath(): string {
  return path.join(os.homedir(), USER_CONFIG_DIR_NAME, USER_CONFIG_FILENAME);
}

/** 获取项目级配置文件路径 (<cwd>/js-reverse.config.json) */
export function getProjectConfigPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), PROJECT_CONFIG_FILENAME);
}

/** 获取项目根目录 config.json 路径 (<cwd>/config.json) */
export function getRootConfigPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), ROOT_CONFIG_FILENAME);
}

/** 安全读取 JSON 配置文件 */
function readConfigFile(filePath: string): GlobalConfig | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    return validateGlobalConfig(JSON.parse(content));
  } catch (error) {
    console.warn(
      `[Config] 读取配置文件失败: ${filePath} — ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

/** 写入配置文件（自动创建目录） */
export function writeConfigFile(filePath: string, config: GlobalConfig): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, {recursive: true});
  }
  const parsed = validateGlobalConfig(config);
  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
}

/** 加载用户级配置 */
export function loadUserConfig(): ConfigSource {
  const filePath = getUserConfigPath();
  const config = readConfigFile(filePath);
  return {
    filePath,
    exists: config !== null,
    config: config ?? undefined,
  };
}

/** 加载项目级配置 */
export function loadProjectConfig(cwd?: string): ConfigSource {
  const filePath = getProjectConfigPath(cwd);
  const config = readConfigFile(filePath);
  return {
    filePath,
    exists: config !== null,
    config: config ?? undefined,
  };
}

/** 加载项目根目录 config.json */
export function loadRootConfig(cwd?: string): ConfigSource {
  const filePath = getRootConfigPath(cwd);
  const config = readConfigFile(filePath);
  return {
    filePath,
    exists: config !== null,
    config: config ?? undefined,
  };
}

/** 合并多个 GlobalConfig（后者覆盖前者） */
export function mergeConfigs(
  ...configs: Array<GlobalConfig | undefined>
): GlobalConfig {
  const result: GlobalConfig = {};
  for (const cfg of configs) {
    if (!cfg) continue;
    const parsed = validateGlobalConfig(cfg);
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }
  return validateGlobalConfig(result);
}

/**
 * 加载完整配置链 — config.json 覆盖项目级，项目级覆盖用户级
 *
 * 返回合并后的 GlobalConfig（不含默认值，仅包含用户/项目显式配置）
 */
export function loadFullConfig(): {
  merged: GlobalConfig;
  sources: ConfigSource[];
} {
  const userSource = loadUserConfig();
  const projectSource = loadProjectConfig();
  const rootSource = loadRootConfig();

  // 合并优先级（低→高）：用户级 < 项目级 < 根目录 config.json
  const merged = mergeConfigs(
    userSource.config,
    projectSource.config,
    rootSource.config,
  );

  return {
    merged,
    sources: [userSource, projectSource, rootSource],
  };
}

// ==========================================================================
// 第四部分：统一环境变量读取 + 配置解析
// ==========================================================================

/** 所有已知环境变量 → GlobalConfig 键映射 */
const ENV_MAP: Readonly<Record<string, keyof GlobalConfig>> = {
  RPC_HOST: 'rpcHost',
  RPC_GROUP: 'group',
  BROWSER_URL: 'browserUrl',
  BROWSER_WS_ENDPOINT: 'wsEndpoint',
  BROWSER_HEADLESS: 'headless',
  BROWSER_EXECUTABLE_PATH: 'executablePath',
  DATABASE_URL: 'databaseUrl',
  JSREVERSER_RUNTIME_DIR: 'runtimeDirName',
  DEFAULT_LLM_PROVIDER: 'llmProvider',
  JSREVERSER_DEBUG: 'debug',
  // OpenAI
  OPENAI_API_KEY: 'openai',
  OPENAI_BASE_URL: 'openai',
  OPENAI_MODEL: 'openai',
  // Browser 扩展
  BROWSER_ISOLATED: 'browser',
  USE_STEALTH_SCRIPTS: 'browser',
  BROWSER_CHANNEL: 'browser',
  REMOTE_DEBUGGING_URL: 'browser',
  REMOTE_DEBUGGING_PORT: 'browser',
  // 日志与会话
  LOG_LEVEL: 'logLevel',
  JSREVERSER_OUTPUT_DIR: 'outputDir',
  JSREVERSER_RECORD_TOOL_RESULTS: 'toolResultRecording',
  JSREVERSER_TOOL_RESULTS_DIR: 'toolResultRecording',
  SESSION_STATE_TTL_MS: 'sessionStateTtlMs',
  SESSION_STATE_CLEANUP_INTERVAL_MS: 'sessionStateCleanupIntervalMs',
  SESSION_STATE_ENCRYPTION_KEY: 'sessionStateEncryptionKey',
};

const BROWSER_ENV_MAP = {
  BROWSER_HEADLESS: 'headless',
  BROWSER_EXECUTABLE_PATH: 'executablePath',
  BROWSER_WS_ENDPOINT: 'wsEndpoint',
  BROWSER_ISOLATED: 'isolated',
  USE_STEALTH_SCRIPTS: 'useStealthScripts',
  BROWSER_CHANNEL: 'channel',
  REMOTE_DEBUGGING_URL: 'remoteDebuggingUrl',
  REMOTE_DEBUGGING_PORT: 'remoteDebuggingPort',
  BROWSER_USER_DATA_DIR: 'userDataDir',
  BROWSER_PATH: 'browserPath',
  BROWSER_USER_AGENT: 'userAgent',
  BROWSER_ACCEPT_INSECURE_CERTS: 'acceptInsecureCerts',
  BROWSER_DEVTOOLS: 'devtools',
  BROWSER_AUTO_LAUNCH: 'autoLaunch',
  BROWSER_WAIT_TIMEOUT_MS: 'waitForBrowserTimeoutMs',
  BROWSER_WAIT_POLL_MS: 'waitForBrowserPollMs',
  BROWSER_TIMEOUT: 'timeout',
  BROWSER_MAX_COLLECTED_URLS: 'maxCollectedUrls',
  BROWSER_MAX_FILES_PER_COLLECT: 'maxFilesPerCollect',
  BROWSER_MAX_TOTAL_CONTENT_SIZE: 'maxTotalContentSize',
  BROWSER_MAX_SINGLE_FILE_SIZE: 'maxSingleFileSize',
} as const;

/**
 * 统一读取环境变量（字符串）
 *
 * @param key 环境变量名
 * @param defaultValue 默认值
 * @returns 环境变量值或默认值
 */
export function getEnvValue(
  key: string,
  defaultValue?: string,
): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  return value;
}

/**
 * 统一读取环境变量（数字）
 *
 * @param key 环境变量名
 * @param defaultValue 默认值
 * @returns 解析后的数字或默认值
 */
export function getEnvNumber(
  key: string,
  defaultValue?: number,
): number | undefined {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}

/**
 * 统一读取环境变量（布尔）
 *
 * 支持 'true' / '1' / 'yes' / 'on' 为 true，'false' / '0' / 'no' / 'off' 为 false
 *
 * @param key 环境变量名
 * @param defaultValue 默认值
 * @returns 解析后的布尔值或默认值
 */
export function getEnvBoolean(
  key: string,
  defaultValue?: boolean,
): boolean | undefined {
  const value = process.env[key]?.toLowerCase().trim();
  if (value === undefined || value === '') return defaultValue;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return defaultValue;
}

/** 从环境变量提取配置 */
function configFromEnv(): GlobalConfig {
  const result: GlobalConfig = {};

  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const value = process.env[envKey];
    if (value === undefined || value === '') continue;
    if (
      configKey === 'openai' ||
      configKey === 'browser' ||
      configKey === 'toolResultRecording'
    )
      continue;

    if (configKey === 'headless' || configKey === 'debug') {
      (result as Record<string, unknown>)[configKey] =
        value === 'true' || value === '1';
    } else {
      (result as Record<string, unknown>)[configKey] = value;
    }
  }

  const openai: GlobalConfig['openai'] = {};
  const openaiApiKey = getEnvValue('OPENAI_API_KEY');
  const openaiBaseURL = getEnvValue('OPENAI_BASE_URL');
  const openaiModel = getEnvValue('OPENAI_MODEL');
  if (openaiApiKey !== undefined) openai.apiKey = openaiApiKey;
  if (openaiBaseURL !== undefined) openai.baseURL = openaiBaseURL;
  if (openaiModel !== undefined) openai.model = openaiModel;
  if (Object.keys(openai).length > 0) result.openai = openai;

  const browser: NonNullable<GlobalConfig['browser']> = {};
  for (const [envKey, browserKey] of Object.entries(BROWSER_ENV_MAP)) {
    const value = process.env[envKey];
    if (value === undefined || value === '') continue;
    (browser as Record<string, unknown>)[browserKey] = value;
  }

  const envBrowserURL = getEnvValue('BROWSER_URL');
  if (envBrowserURL !== undefined) browser.browserURL = envBrowserURL;

  const envWsHeaders = getEnvValue('BROWSER_WS_HEADERS');
  if (envWsHeaders !== undefined) {
    browser.wsHeaders = JSON.parse(envWsHeaders) as Record<string, string>;
  }

  const envArgs = getEnvValue('BROWSER_ARGS');
  if (envArgs !== undefined) {
    browser.args = envArgs
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  if (Object.keys(browser).length > 0) {
    result.browser = {
      ...result.browser,
      ...browser,
    };
  }

  const toolResultRecording: NonNullable<GlobalConfig['toolResultRecording']> =
    {};
  const recordToolResults = getEnvBoolean('JSREVERSER_RECORD_TOOL_RESULTS');
  const toolResultsDir = getEnvValue('JSREVERSER_TOOL_RESULTS_DIR');
  if (recordToolResults !== undefined) {
    toolResultRecording.enabled = recordToolResults;
  }
  if (toolResultsDir !== undefined) {
    toolResultRecording.outputDir = toolResultsDir;
  }
  if (Object.keys(toolResultRecording).length > 0) {
    result.toolResultRecording = toolResultRecording;
  }

  return validateGlobalConfig(result);
}

/**
 * 解析最终 CLI 配置 — 合并所有来源，应用默认值
 *
 * 优先级（高→低）：envArgs > 环境变量 > 项目配置 > 用户配置 > 默认值
 *
 * @param envArgs CLI 参数或显式传入的覆盖值
 */
export function resolveConfig(envArgs?: Partial<GlobalConfig>): ResolvedConfig {
  const {merged: fileConfig} = loadFullConfig();
  const envConfig = configFromEnv();

  // 按优先级合并：文件配置 < 环境变量 < 显式参数
  const merged = mergeConfigs(fileConfig, envConfig, envArgs);
  const parsed = validateGlobalConfig(merged);

  return {
    rpcHost: parsed.rpcHost ?? DEFAULTS.rpcHost,
    group: parsed.group ?? DEFAULTS.group,
    browserUrl: parsed.browserUrl || undefined,
    wsEndpoint: parsed.wsEndpoint || undefined,
    headless: parsed.headless ?? DEFAULTS.headless,
    executablePath: parsed.executablePath,
    databaseUrl: parsed.databaseUrl || undefined,
    runtimeDirName: parsed.runtimeDirName ?? DEFAULTS.runtimeDirName,
    debug: parsed.debug ?? DEFAULTS.debug,
  };
}

/**
 * 初始化用户级配置文件（若不存在则创建）
 */
export function initUserConfig(): {path: string; created: boolean} {
  const filePath = getUserConfigPath();
  if (existsSync(filePath)) {
    return {path: filePath, created: false};
  }

  const defaultConfig: GlobalConfig = {
    rpcHost: DEFAULT_RPC_HOST,
    group: DEFAULT_GROUP,
    headless: false,
    debug: false,
  };

  writeConfigFile(filePath, defaultConfig);
  return {path: filePath, created: true};
}

/**
 * 设置用户级配置项
 */
export function setUserConfigValue(
  key: keyof GlobalConfig,
  value: unknown,
): void {
  const filePath = getUserConfigPath();
  const existing = readConfigFile(filePath) ?? {};
  (existing as Record<string, unknown>)[key] = value;
  writeConfigFile(filePath, existing);
}

/**
 * 删除用户级配置项
 */
export function deleteUserConfigValue(key: keyof GlobalConfig): boolean {
  const filePath = getUserConfigPath();
  const existing = readConfigFile(filePath);
  if (!existing || !(key in existing)) return false;
  delete (existing as Record<string, unknown>)[key];
  writeConfigFile(filePath, existing);
  return true;
}

/**
 * 显示当前生效的配置及来源
 */
export function showConfigInfo(): {
  resolved: ResolvedConfig;
  sources: ConfigSource[];
  envOverrides: string[];
} {
  const {sources} = loadFullConfig();
  const envOverrides = Object.keys(ENV_MAP).filter(
    k => getEnvValue(k) !== undefined,
  );

  const resolved = resolveConfig();

  return {resolved, sources, envOverrides};
}

export function getToolResultRecordingConfig(): ResolvedToolResultRecordingConfig {
  const {merged: fileConfig} = loadFullConfig();
  const envEnabled = getEnvBoolean('JSREVERSER_RECORD_TOOL_RESULTS');
  const envOutputDir = getEnvValue('JSREVERSER_TOOL_RESULTS_DIR');
  const outputDir =
    envOutputDir ??
    fileConfig.toolResultRecording?.outputDir ??
    (fileConfig.outputDir
      ? path.join(fileConfig.outputDir, 'tool-results')
      : path.join(os.homedir(), USER_CONFIG_DIR_NAME, 'tool-results'));

  return {
    enabled: envEnabled ?? fileConfig.toolResultRecording?.enabled ?? false,
    outputDir,
  };
}

// ==========================================================================
// 第五部分：AI / Browser / System 配置（原 src/utils/config.ts）
// ==========================================================================

/**
 * 获取默认 LLM 提供商
 *
 * 优先级：环境变量 > config.json > 默认值
 */
export function getDefaultLLMProvider(): LLMProvider {
  const envProvider = getEnvValue('DEFAULT_LLM_PROVIDER')?.toLowerCase();
  if (envProvider === 'openai') return envProvider;

  const {merged: fileConfig} = loadFullConfig();
  if (fileConfig.llmProvider) return fileConfig.llmProvider;

  return 'openai';
}

/**
 * 从环境变量 + config.json 获取 AI 配置
 *
 * 优先级：环境变量 > config.json 中的对应字段
 */
export function getAIConfig(): AIConfig | undefined {
  const provider = getDefaultLLMProvider();
  const {merged: fileConfig} = loadFullConfig();

  const config: AIConfig = {
    provider,
  };

  // OpenAI：环境变量 > config.json
  const openaiApiKey = getEnvValue('OPENAI_API_KEY');
  if (openaiApiKey) {
    config.openai = {
      apiKey: openaiApiKey,
      baseURL: getEnvValue('OPENAI_BASE_URL'),
      model: getEnvValue('OPENAI_MODEL') || 'gpt-4o',
    };
  } else if (fileConfig.openai) {
    config.openai = {
      apiKey: fileConfig.openai.apiKey || '',
      baseURL: fileConfig.openai.baseURL,
      model: fileConfig.openai.model || 'gpt-4o',
    };
  }

  const hasAnyProvider = config.openai;

  return hasAnyProvider ? config : undefined;
}

/**
 * 从环境变量 + config.json 获取浏览器配置
 *
 * 优先级：环境变量 > config.json 中的 browser 字段
 */
export function getBrowserManagerConfig(): BrowserManagerConfig {
  const {merged: fileConfig} = loadFullConfig();
  const fileBrowser = fileConfig.browser;

  const config: BrowserManagerConfig = {
    headless:
      getEnvBoolean('BROWSER_HEADLESS') ?? fileBrowser?.headless ?? true,
    isolated:
      getEnvBoolean('BROWSER_ISOLATED') ?? fileBrowser?.isolated ?? true,
    useStealthScripts:
      getEnvBoolean('USE_STEALTH_SCRIPTS') ??
      fileBrowser?.useStealthScripts ??
      false,
  };

  const envExecutablePath = getEnvValue('BROWSER_EXECUTABLE_PATH');
  if (envExecutablePath) {
    config.executablePath = envExecutablePath;
  } else if (fileBrowser?.executablePath) {
    config.executablePath = fileBrowser.executablePath;
  }

  const envChannel = getEnvValue('BROWSER_CHANNEL');
  if (envChannel) {
    config.channel = envChannel as BrowserManagerConfig['channel'];
  } else if (fileBrowser?.channel) {
    config.channel = fileBrowser.channel as BrowserManagerConfig['channel'];
  }

  const envBrowserURL = getEnvValue('BROWSER_URL');
  if (envBrowserURL) {
    config.browserURL = envBrowserURL;
  } else if (fileBrowser?.browserURL) {
    config.browserURL = fileBrowser.browserURL;
  } else if (fileConfig.browserUrl) {
    config.browserURL = fileConfig.browserUrl;
  }

  const envWsEndpoint = getEnvValue('BROWSER_WS_ENDPOINT');
  if (envWsEndpoint) {
    config.wsEndpoint = envWsEndpoint;
  } else if (fileBrowser?.wsEndpoint) {
    config.wsEndpoint = fileBrowser.wsEndpoint;
  } else if (fileConfig.wsEndpoint) {
    config.wsEndpoint = fileConfig.wsEndpoint;
  }

  const envRemoteDebuggingUrl = getEnvValue('REMOTE_DEBUGGING_URL');
  if (envRemoteDebuggingUrl) {
    config.remoteDebuggingUrl = envRemoteDebuggingUrl;
  } else if (fileBrowser?.remoteDebuggingUrl) {
    config.remoteDebuggingUrl = fileBrowser.remoteDebuggingUrl;
  }

  const envRemoteDebuggingPort = getEnvNumber('REMOTE_DEBUGGING_PORT');
  if (envRemoteDebuggingPort !== undefined) {
    config.remoteDebuggingPort = envRemoteDebuggingPort;
  } else if (fileBrowser?.remoteDebuggingPort !== undefined) {
    config.remoteDebuggingPort = fileBrowser.remoteDebuggingPort;
  }

  const envUserDataDir = getEnvValue('BROWSER_USER_DATA_DIR');
  if (envUserDataDir) {
    config.userDataDir = envUserDataDir;
  } else if (fileBrowser?.userDataDir) {
    config.userDataDir = fileBrowser.userDataDir;
  }

  const envBrowserPath = getEnvValue('BROWSER_PATH');
  if (envBrowserPath) {
    config.browserPath = envBrowserPath;
  } else if (fileBrowser?.browserPath) {
    config.browserPath = fileBrowser.browserPath;
  }

  const envUserAgent = getEnvValue('BROWSER_USER_AGENT');
  if (envUserAgent) {
    config.userAgent = envUserAgent;
  } else if (fileBrowser?.userAgent) {
    config.userAgent = fileBrowser.userAgent;
  }

  const envAcceptInsecureCerts = getEnvBoolean('BROWSER_ACCEPT_INSECURE_CERTS');
  if (envAcceptInsecureCerts !== undefined) {
    config.acceptInsecureCerts = envAcceptInsecureCerts;
  } else if (fileBrowser?.acceptInsecureCerts !== undefined) {
    config.acceptInsecureCerts = fileBrowser.acceptInsecureCerts;
  }

  const envDevtools = getEnvBoolean('BROWSER_DEVTOOLS');
  if (envDevtools !== undefined) {
    config.devtools = envDevtools;
  } else if (fileBrowser?.devtools !== undefined) {
    config.devtools = fileBrowser.devtools;
  }

  const envAutoLaunch = getEnvBoolean('BROWSER_AUTO_LAUNCH');
  if (envAutoLaunch !== undefined) {
    config.autoLaunch = envAutoLaunch;
  } else if (fileBrowser?.autoLaunch !== undefined) {
    config.autoLaunch = fileBrowser.autoLaunch;
  }

  const envWaitTimeout = getEnvNumber('BROWSER_WAIT_TIMEOUT_MS');
  if (envWaitTimeout !== undefined) {
    config.waitForBrowserTimeoutMs = envWaitTimeout;
  } else if (fileBrowser?.waitForBrowserTimeoutMs !== undefined) {
    config.waitForBrowserTimeoutMs = fileBrowser.waitForBrowserTimeoutMs;
  }

  const envWaitPoll = getEnvNumber('BROWSER_WAIT_POLL_MS');
  if (envWaitPoll !== undefined) {
    config.waitForBrowserPollMs = envWaitPoll;
  } else if (fileBrowser?.waitForBrowserPollMs !== undefined) {
    config.waitForBrowserPollMs = fileBrowser.waitForBrowserPollMs;
  }

  const envTimeout = getEnvNumber('BROWSER_TIMEOUT');
  if (envTimeout !== undefined) {
    config.timeout = envTimeout;
  } else if (fileBrowser?.timeout !== undefined) {
    config.timeout = fileBrowser.timeout;
  }

  const envMaxUrls = getEnvNumber('BROWSER_MAX_COLLECTED_URLS');
  if (envMaxUrls !== undefined) {
    config.maxCollectedUrls = envMaxUrls;
  } else if (fileBrowser?.maxCollectedUrls !== undefined) {
    config.maxCollectedUrls = fileBrowser.maxCollectedUrls;
  }

  const envMaxFiles = getEnvNumber('BROWSER_MAX_FILES_PER_COLLECT');
  if (envMaxFiles !== undefined) {
    config.maxFilesPerCollect = envMaxFiles;
  } else if (fileBrowser?.maxFilesPerCollect !== undefined) {
    config.maxFilesPerCollect = fileBrowser.maxFilesPerCollect;
  }

  const envMaxTotalSize = getEnvNumber('BROWSER_MAX_TOTAL_CONTENT_SIZE');
  if (envMaxTotalSize !== undefined) {
    config.maxTotalContentSize = envMaxTotalSize;
  } else if (fileBrowser?.maxTotalContentSize !== undefined) {
    config.maxTotalContentSize = fileBrowser.maxTotalContentSize;
  }

  const envMaxSingleSize = getEnvNumber('BROWSER_MAX_SINGLE_FILE_SIZE');
  if (envMaxSingleSize !== undefined) {
    config.maxSingleFileSize = envMaxSingleSize;
  } else if (fileBrowser?.maxSingleFileSize !== undefined) {
    config.maxSingleFileSize = fileBrowser.maxSingleFileSize;
  }

  const envWsHeaders = getEnvValue('BROWSER_WS_HEADERS');
  if (envWsHeaders) {
    try {
      config.wsHeaders = JSON.parse(envWsHeaders) as Record<string, string>;
    } catch {
      // 忽略非法 JSON
    }
  } else if (fileBrowser?.wsHeaders) {
    config.wsHeaders = fileBrowser.wsHeaders;
  }

  const envArgs = getEnvValue('BROWSER_ARGS');
  if (envArgs) {
    config.args = envArgs
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  } else if (fileBrowser?.args) {
    config.args = fileBrowser.args;
  }

  if (fileBrowser?.viewport) {
    config.viewport = fileBrowser.viewport;
  }

  return config;
}

/**
 * @deprecated Use getBrowserManagerConfig.
 */
export const getBrowserConfig = getBrowserManagerConfig;

/**
 * 获取完整系统配置
 */
export function getSystemConfig(): SystemConfig {
  return validateSystemConfig({
    ai: getAIConfig(),
    browser: getBrowserManagerConfig(),
    debug: isDebugEnabled(),
  });
}

/**
 * 校验配置
 */
export function validateConfig(config: SystemConfig): {
  valid: boolean;
  errors: string[];
} {
  const result = SystemConfigSchema.safeParse(config);
  if (result.success) {
    return {valid: true, errors: []};
  }

  return {
    valid: false,
    errors: [formatConfigValidationError(result.error)],
  };
}

/**
 * 获取环境变量（带默认值）
 * @deprecated 请使用 getEnvValue
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return getEnvValue(key, defaultValue);
}

/**
 * 检查调试模式是否启用
 */
export function isDebugEnabled(): boolean {
  const debug = getEnvValue('DEBUG');
  return debug === 'true' || debug?.includes('mcp') || false;
}

/**
 * 创建 AI Service 实例
 */
export function createAIService(config?: AIConfig): AIService | undefined {
  const aiConfig = config || getAIConfig();

  if (!aiConfig) {
    return undefined;
  }

  const {provider} = aiConfig;

  switch (provider) {
    case 'openai': {
      if (!aiConfig.openai) {
        throw new Error('OpenAI configuration not found');
      }
      return new AIService(
        new OpenAIProvider({
          apiKey: aiConfig.openai.apiKey,
          baseURL: aiConfig.openai.baseURL,
          model: aiConfig.openai.model,
        }),
      );
    }

    default: {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
