/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable import/no-cycle -- 已知例外：loadUserConfig() 播种 store 与 getRuntimeConfigStore() 读回 store 的初始化时序契约。见 spec §2.1 目标 2 与 §5.1 环 1 决议 A，Phase 4 复核。 */

/**
 * 核心配置基础设施 — 配置文件读写、环境变量工具、CLI 配置解析、RuntimeConfigStore 播种
 *
 * 配置优先级（高 → 低）：
 * 1. CLI 参数（--browserUrl 等）
 * 2. 配置文件（~/.browsercli/config.json）
 * 3. 内置默认值
 *
 * 默认使用 ~/.browsercli/config.json 配置，不再支持 .env。
 * 配置载入后存入 RuntimeConfigStore 内存态，由前端控制面板管理。
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  RUNTIME_DIR_NAME,
  USER_CONFIG_DIR_NAME,
  USER_CONFIG_FILENAME,
} from './constants.js';
import {getRuntimeConfigStore} from './RuntimeConfigStore.js';
import {
  type GlobalConfig,
  type SystemConfig,
  validateGlobalConfig,
} from './schema.js';

// ==========================================================================
// 第一部分：类型定义与默认值
// ==========================================================================

/** 用户级全局配置结构（配置文件可写的所有字段） */
export type {GlobalConfig};

/** 系统配置（Browser + Debug） */
export type {SystemConfig};

/** CLI 层解析后的完整配置 */
export interface ResolvedConfig {
  browserUrl?: string;
  wsEndpoint?: string;
  headless: boolean;
  executablePath?: string;
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
  BROWSER_URL: 'browserUrl',
  BROWSER_WS_ENDPOINT: 'wsEndpoint',
  BROWSER_HEADLESS: 'headless',
  BROWSER_EXECUTABLE_PATH: 'executablePath',
  BROWSER_RUNTIME_DIR: 'runtimeDirName',
  BROWSER_DEBUG: 'debug',
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
    if (configKey === 'browser' || configKey === 'toolResultRecording')
      continue;

    if (BOOLEAN_CONFIG_KEYS.has(configKey)) {
      (result as Record<string, unknown>)[configKey] =
        value === 'true' || value === '1';
    } else {
      (result as Record<string, unknown>)[configKey] = value;
    }
  }

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
    try {
      browser.wsHeaders = JSON.parse(envWsHeaders) as Record<string, string>;
    } catch {
      // 忽略非法 JSON
    }
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

/** 获取用户级配置文件路径 (~/.browsercli/config.json，支持 BROWSERCLI_CONFIG_DIR 覆盖) */
export function getUserConfigPath(): string {
  const custom =
    process.env.BROWSERCLI_CONFIG_DIR ?? process.env.PROXYCLI_CONFIG_DIR;
  if (custom) return path.join(custom, USER_CONFIG_FILENAME);
  return path.join(os.homedir(), USER_CONFIG_DIR_NAME, USER_CONFIG_FILENAME);
}

/** 加载用户级配置文件 (~/.browsercli/config.json) */
export function loadUserConfig(filePath = getUserConfigPath()): GlobalConfig {
  try {
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return {};
    return validateGlobalConfig(JSON.parse(content));
  } catch (error) {
    console.warn(
      `[Config] 读取配置文件失败: ${filePath} — ${error instanceof Error ? error.message : error}`,
    );
    return {};
  }
}

/** 写入用户级配置文件 (~/.browsercli/config.json) */
export function writeUserConfig(
  config: GlobalConfig,
  filePath = getUserConfigPath(),
): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, {recursive: true});
  }
  const parsed = validateGlobalConfig(config);
  writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
}

/**
 * 解析最终 CLI 配置 — 合并配置文件与 CLI 参数，应用默认值
 *
 * 优先级（高→低）：envArgs > ~/.browsercli/config.json > 默认值
 *
 * @param envArgs CLI 参数或显式传入的覆盖值
 */
export function resolveConfig(envArgs?: Partial<GlobalConfig>): ResolvedConfig {
  const fileConfig = loadUserConfig();
  const merged = validateGlobalConfig({...fileConfig, ...envArgs});

  return {
    browserUrl: merged.browserUrl || undefined,
    wsEndpoint: merged.wsEndpoint || undefined,
    headless: merged.headless ?? DEFAULTS.headless,
    executablePath: merged.executablePath,
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
