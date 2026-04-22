/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 全局统一配置 — 整合 CLI 配置、全局配置文件、AI/Browser 系统配置
 *
 * 配置优先级（高 → 低）：
 * 1. CLI 参数（--sekiroHost 等）
 * 2. 环境变量（SEKIRO_HOST, OPENAI_API_KEY 等）
 * 3. 项目级配置文件（<cwd>/js-reverse.config.json）
 * 4. 用户级配置文件（~/.jsreverserrc.json）
 * 5. 内置默认值
 *
 * 本文件合并了原先分散在以下三处的配置逻辑：
 * - src/cli/global-config.ts（全局配置文件加载/解析）
 * - src/cli/config.ts（CLI 常量 + 重新导出）
 * - src/utils/config.ts（.env 加载、AI/Browser 系统配置）
 */

import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {config as dotenvConfig} from 'dotenv';

import {resolveDefaultEnvPath} from './utils/projectPaths.js';
import {AIService} from './services/AIService.js';
import {AnthropicProvider} from './services/AnthropicProvider.js';
import {GeminiProvider} from './services/GeminiProvider.js';
import {OpenAIProvider} from './services/OpenAIProvider.js';

// ==================== .env 加载 ====================

const envPath = resolveDefaultEnvPath(import.meta.url);
if (existsSync(envPath)) {
  dotenvConfig({path: envPath});
}

// ==========================================================================
// 第一部分：常量与默认值
// ==========================================================================

/** Sekiro Server 默认 WebSocket 地址 */
export const DEFAULT_SEKIRO_HOST = 'ws://127.0.0.1:5612';

/** Sekiro 默认分组名 */
export const DEFAULT_GROUP = 'js-reverse';

/** Worker 进程运行时目录 */
export const RUNTIME_DIR_NAME = 'js-reverse';

/** 用户级配置文件名 */
const USER_CONFIG_FILENAME = '.jsreverserrc.json';

/** 项目级配置文件名 */
const PROJECT_CONFIG_FILENAME = 'js-reverse.config.json';

// ==========================================================================
// 第二部分：类型定义
// ==========================================================================

/** LLM 提供商类型 */
export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

/** 用户级全局配置结构（配置文件可写的所有字段） */
export interface GlobalConfig {
  /** Sekiro Server WebSocket 地址 */
  sekiroHost?: string;
  /** Sekiro 分组名 */
  group?: string;
  /** 浏览器调试 URL */
  browserUrl?: string;
  /** WebSocket 端点 */
  wsEndpoint?: string;
  /** 无头模式 */
  headless?: boolean;
  /** 浏览器可执行路径 */
  executablePath?: string;
  /** Worker 运行时目录名 */
  runtimeDirName?: string;
  /** AI 提供商 */
  llmProvider?: LLMProvider;
  /** OpenAI 配置 */
  openai?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
  };
  /** Anthropic 配置 */
  anthropic?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
  };
  /** Gemini 配置 */
  gemini?: {
    apiKey?: string;
    cliPath?: string;
    model?: string;
  };
  /** 浏览器配置 */
  browser?: {
    headless?: boolean;
    isolated?: boolean;
    executablePath?: string;
    channel?: 'chrome' | 'chrome-beta' | 'chrome-dev' | 'chrome-canary' | 'msedge';
    useStealthScripts?: boolean;
    viewport?: {width: number; height: number};
  };
  /** 调试模式 */
  debug?: boolean;
}

/** AI Service 配置（运行时解析后的完整结构） */
export interface AIConfig {
  provider: LLMProvider;
  openai?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  anthropic?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  gemini?: {
    apiKey?: string;
    cliPath?: string;
    useAPI?: boolean;
    model?: string;
  };
}

/** 浏览器配置（运行时解析后的完整结构） */
export interface BrowserConfig {
  headless?: boolean;
  executablePath?: string;
  channel?:
    | 'chrome'
    | 'chrome-beta'
    | 'chrome-dev'
    | 'chrome-canary'
    | 'msedge';
  isolated?: boolean;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  useStealthScripts?: boolean;
  viewport?: {width: number; height: number};
}

/** 系统配置（AI + Browser + Debug） */
export interface SystemConfig {
  ai?: AIConfig;
  browser: BrowserConfig;
  debug?: boolean;
}

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
  sekiroHost: string;
  group: string;
  browserUrl?: string;
  wsEndpoint?: string;
  headless: boolean;
  executablePath?: string;
  runtimeDirName: string;
  debug: boolean;
}

/** 内置默认值 */
const DEFAULTS: Readonly<ResolvedConfig> = {
  sekiroHost: DEFAULT_SEKIRO_HOST,
  group: DEFAULT_GROUP,
  headless: false,
  runtimeDirName: RUNTIME_DIR_NAME,
  debug: false,
} as const;

// ==========================================================================
// 第三部分：全局配置文件管理（~/.jsreverserrc.json + js-reverse.config.json）
// ==========================================================================

/** 获取用户级配置文件路径 (~/.jsreverserrc.json) */
export function getUserConfigPath(): string {
  return path.join(os.homedir(), USER_CONFIG_FILENAME);
}

/** 获取项目级配置文件路径 (<cwd>/js-reverse.config.json) */
export function getProjectConfigPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), PROJECT_CONFIG_FILENAME);
}

/** 安全读取 JSON 配置文件 */
function readConfigFile(filePath: string): GlobalConfig | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    return JSON.parse(content) as GlobalConfig;
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
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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

/** 合并多个 GlobalConfig（后者覆盖前者） */
export function mergeConfigs(...configs: Array<GlobalConfig | undefined>): GlobalConfig {
  const result: GlobalConfig = {};
  for (const cfg of configs) {
    if (!cfg) continue;
    for (const [key, value] of Object.entries(cfg)) {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }
  return result;
}

/**
 * 加载完整配置链 — 项目级覆盖用户级
 *
 * 返回合并后的 GlobalConfig（不含默认值，仅包含用户/项目显式配置）
 */
export function loadFullConfig(): {merged: GlobalConfig; sources: ConfigSource[]} {
  const userSource = loadUserConfig();
  const projectSource = loadProjectConfig();

  const merged = mergeConfigs(userSource.config, projectSource.config);

  return {
    merged,
    sources: [userSource, projectSource],
  };
}

// ==========================================================================
// 第四部分：环境变量映射 + 配置解析
// ==========================================================================

/** 环境变量 → GlobalConfig 键映射 */
const ENV_MAP: Readonly<Record<string, keyof GlobalConfig>> = {
  SEKIRO_HOST: 'sekiroHost',
  SEKIRO_GROUP: 'group',
  BROWSER_URL: 'browserUrl',
  BROWSER_WS_ENDPOINT: 'wsEndpoint',
  BROWSER_HEADLESS: 'headless',
  BROWSER_EXECUTABLE_PATH: 'executablePath',
  JSREVERSER_RUNTIME_DIR: 'runtimeDirName',
  DEFAULT_LLM_PROVIDER: 'llmProvider',
  JSREVERSER_DEBUG: 'debug',
};

/** 从环境变量提取配置 */
function configFromEnv(): GlobalConfig {
  const result: GlobalConfig = {};

  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const value = process.env[envKey];
    if (value === undefined || value === '') continue;

    if (configKey === 'headless' || configKey === 'debug') {
      (result as Record<string, unknown>)[configKey] = value === 'true' || value === '1';
    } else {
      (result as Record<string, unknown>)[configKey] = value;
    }
  }

  return result;
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

  return {
    sekiroHost: merged.sekiroHost ?? DEFAULTS.sekiroHost,
    group: merged.group ?? DEFAULTS.group,
    browserUrl: merged.browserUrl,
    wsEndpoint: merged.wsEndpoint,
    headless: merged.headless ?? DEFAULTS.headless,
    executablePath: merged.executablePath,
    runtimeDirName: merged.runtimeDirName ?? DEFAULTS.runtimeDirName,
    debug: merged.debug ?? DEFAULTS.debug,
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
    sekiroHost: DEFAULT_SEKIRO_HOST,
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
export function setUserConfigValue(key: keyof GlobalConfig, value: unknown): void {
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
  const envOverrides = Object.keys(ENV_MAP).filter(k => process.env[k]);

  const resolved = resolveConfig();

  return {resolved, sources, envOverrides};
}

// ==========================================================================
// 第五部分：AI / Browser / System 配置（原 src/utils/config.ts）
// ==========================================================================

/**
 * 获取默认 LLM 提供商
 */
export function getDefaultLLMProvider(): LLMProvider {
  const provider = process.env.DEFAULT_LLM_PROVIDER?.toLowerCase();
  if (
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'gemini'
  )
    return provider;
  return 'gemini';
}

/**
 * 从环境变量获取 AI 配置
 */
export function getAIConfig(): AIConfig | undefined {
  const provider = getDefaultLLMProvider();

  const config: AIConfig = {
    provider,
  };

  if (process.env.OPENAI_API_KEY) {
    config.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    };
  }

  config.gemini = {
    apiKey: process.env.GEMINI_API_KEY,
    cliPath: process.env.GEMINI_CLI_PATH || 'gemini-cli',
    useAPI: !!process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
  };

  const hasAnyProvider = config.openai || config.anthropic || config.gemini;

  return hasAnyProvider ? config : undefined;
}

/**
 * 从环境变量获取浏览器配置
 */
export function getBrowserConfig(): BrowserConfig {
  const config: BrowserConfig = {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    isolated: process.env.BROWSER_ISOLATED !== 'false',
    useStealthScripts: process.env.USE_STEALTH_SCRIPTS === 'true',
  };

  if (process.env.BROWSER_EXECUTABLE_PATH) {
    config.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  }

  if (process.env.BROWSER_CHANNEL) {
    config.channel = process.env.BROWSER_CHANNEL as BrowserConfig['channel'];
  }

  if (process.env.REMOTE_DEBUGGING_URL) {
    config.remoteDebuggingUrl = process.env.REMOTE_DEBUGGING_URL;
  }

  if (process.env.REMOTE_DEBUGGING_PORT) {
    config.remoteDebuggingPort = parseInt(
      process.env.REMOTE_DEBUGGING_PORT,
      10,
    );
  }

  return config;
}

/**
 * 获取完整系统配置
 */
export function getSystemConfig(): SystemConfig {
  return {
    ai: getAIConfig(),
    browser: getBrowserConfig(),
    debug: isDebugEnabled(),
  };
}

/**
 * 校验配置
 */
export function validateConfig(config: SystemConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.browser.remoteDebuggingPort !== undefined) {
    const port = config.browser.remoteDebuggingPort;
    if (port < 1 || port > 65535) {
      errors.push(
        `Invalid REMOTE_DEBUGGING_PORT: ${port}. Must be between 1 and 65535.`,
      );
    }
  }

  if (config.ai) {
    const {provider} = config.ai;

    if (provider === 'openai' && !config.ai.openai) {
      errors.push('OpenAI provider selected but OPENAI_API_KEY not configured');
    }

    if (provider === 'anthropic' && !config.ai.anthropic) {
      errors.push(
        'Anthropic provider selected but ANTHROPIC_API_KEY not configured',
      );
    }

    if (provider === 'gemini' && !config.ai.gemini) {
      errors.push('Gemini provider selected but no configuration found');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 获取环境变量（带默认值）
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

/**
 * 检查调试模式是否启用
 */
export function isDebugEnabled(): boolean {
  return (
    process.env.DEBUG === 'true' || process.env.DEBUG?.includes('mcp') || false
  );
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

    case 'anthropic': {
      if (!aiConfig.anthropic) {
        throw new Error('Anthropic configuration not found');
      }
      return new AIService(
        new AnthropicProvider({
          apiKey: aiConfig.anthropic.apiKey,
          baseURL: aiConfig.anthropic.baseURL,
          model: aiConfig.anthropic.model,
        }),
      );
    }

    case 'gemini': {
      if (!aiConfig.gemini) {
        throw new Error('Gemini configuration not found');
      }
      return new AIService(
        new GeminiProvider({
          apiKey: aiConfig.gemini.apiKey,
          cliPath: aiConfig.gemini.cliPath,
          useAPI: aiConfig.gemini.useAPI,
          model: aiConfig.gemini.model,
        }),
      );
    }

    default: {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
