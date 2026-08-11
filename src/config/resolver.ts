/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable import/no-cycle -- resolver re-exports servicesConfig factories for backward compat while servicesConfig consumes core resolver helpers (getEnvValue/configFromEnv). The mutual dependency is intentional. */

/**
 * 核心配置基础设施 — 环境变量工具、CLI 配置解析、RuntimeConfigStore 播种
 *
 * 配置优先级（高 → 低）：
 * 1. CLI 参数（--rpcHost 等）
 * 2. 环境变量（RPC_HOST, OPENAI_API_KEY 等）
 * 3. 内置默认值
 *
 * config.json 文件加载已移除，配置改为 RuntimeConfigStore 内存态，
 * 由前端控制面板管理（见 RuntimeConfigStore.ts）。
 */

import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {config as dotenvConfig} from 'dotenv';

import {resolveDefaultEnvPath} from '../utils/projectPaths.js';

import {
  DEFAULT_GROUP,
  DEFAULT_RPC_HOST,
  RUNTIME_DIR_NAME,
} from './constants.js';
import {getRuntimeConfigStore} from './RuntimeConfigStore.js';
import {
  type AIConfig,
  type GlobalConfig,
  type SystemConfig,
  validateGlobalConfig,
} from './schema.js';

// ==================== .env 加载 ====================

const envPath = resolveDefaultEnvPath(import.meta.url);
if (existsSync(envPath)) {
  dotenvConfig({path: envPath});
}

// ==========================================================================
// 第一部分：类型定义与默认值
// ==========================================================================

/** LLM 提供商类型 */
export type LLMProvider = GlobalConfig['llmProvider'] & string;

/** 用户级全局配置结构（配置文件可写的所有字段） */
export type {GlobalConfig};

/** AI Service 配置（运行时解析后的完整结构） */
export type {AIConfig};

/** 系统配置（AI + Browser + Debug） */
export type {SystemConfig};

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
  /** 启用 CloakBrowser 二进制 + 49 C++ patch。 */
  cloak: boolean;
  /** Opt-in StealthScripts2025 JS 注入。 */
  jsStealth: boolean;
  /** 回退到历史 60+ 启动参数集。 */
  fullStealthArgs: boolean;
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
  cloak: false,
  jsStealth: false,
  fullStealthArgs: false,
} as const;

// ==========================================================================
// 第二部分：环境变量读取 + 配置解析
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
  BROWSER_RUNTIME_DIR: 'runtimeDirName',
  DEFAULT_LLM_PROVIDER: 'llmProvider',
  BROWSER_DEBUG: 'debug',
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
  BROWSER_OUTPUT_DIR: 'outputDir',
  BROWSER_RECORD_TOOL_RESULTS: 'toolResultRecording',
  BROWSER_TOOL_RESULTS_DIR: 'toolResultRecording',
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
  BROWSER_JS_STEALTH: 'jsStealth',
  BROWSER_CLOAK: 'cloak',
  BROWSER_FULL_STEALTH_ARGS: 'fullStealthArgs',
  BROWSER_MINIMAL_STEALTH: 'minimalStealth',
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

/** GlobalConfig keys that must be coerced to boolean when read from env. */
const BOOLEAN_CONFIG_KEYS = new Set<keyof GlobalConfig>(['headless', 'debug']);

/** 从环境变量提取配置 */
export function configFromEnv(): GlobalConfig {
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

    if (BOOLEAN_CONFIG_KEYS.has(configKey)) {
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
  const recordToolResults = getEnvBoolean('BROWSER_RECORD_TOOL_RESULTS');
  const toolResultsDir = getEnvValue('BROWSER_TOOL_RESULTS_DIR');
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
 * 解析最终 CLI 配置 — 合并环境变量与 CLI 参数，应用默认值
 *
 * 优先级（高→低）：envArgs > 环境变量 > 默认值
 *
 * @param envArgs CLI 参数或显式传入的覆盖值
 */
export function resolveConfig(envArgs?: Partial<GlobalConfig>): ResolvedConfig {
  const envConfig = configFromEnv();
  const merged = validateGlobalConfig({...envConfig, ...envArgs});

  return {
    rpcHost: merged.rpcHost ?? DEFAULTS.rpcHost,
    group: merged.group ?? DEFAULTS.group,
    browserUrl: merged.browserUrl || undefined,
    wsEndpoint: merged.wsEndpoint || undefined,
    headless: merged.headless ?? DEFAULTS.headless,
    executablePath: merged.executablePath,
    databaseUrl: merged.databaseUrl || undefined,
    runtimeDirName: merged.runtimeDirName ?? DEFAULTS.runtimeDirName,
    debug: merged.debug ?? DEFAULTS.debug,
    cloak: merged.cloak ?? DEFAULTS.cloak,
    jsStealth: merged.jsStealth ?? DEFAULTS.jsStealth,
    fullStealthArgs: merged.fullStealthArgs ?? DEFAULTS.fullStealthArgs,
  };
}

export function getToolResultRecordingConfig(): ResolvedToolResultRecordingConfig {
  const fileConfig = getRuntimeConfigStore().get();
  const envEnabled = getEnvBoolean('BROWSER_RECORD_TOOL_RESULTS');
  const envOutputDir = getEnvValue('BROWSER_TOOL_RESULTS_DIR');
  const outputDir =
    envOutputDir ??
    fileConfig.toolResultRecording?.outputDir ??
    (fileConfig.outputDir
      ? path.join(fileConfig.outputDir, 'tool-results')
      : path.join(os.homedir(), '.browsercli', 'tool-results'));

  return {
    enabled: envEnabled ?? fileConfig.toolResultRecording?.enabled ?? false,
    outputDir,
  };
}

// ==========================================================================
// 第三部分：服务配置（AI / Browser / System）— 已拆分至 servicesConfig.ts
// ==========================================================================

export {
  createAIService,
  getAIConfig,
  getBrowserConfig,
  getBrowserManagerConfig,
  getDefaultLLMProvider,
  getEnv,
  getSystemConfig,
  isDebugEnabled,
  validateConfig,
} from './servicesConfig.js';
