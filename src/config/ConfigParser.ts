/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置文件解析器（参考 chrome-devtools-mcp/src/config/ConfigParser.ts）。
 *
 * 独立于 RuntimeConfigStore 和 resolver，作为纯 L0 基础设施：
 * - 统一处理 UTF-8 BOM（Windows PowerShell 5.1 写盘常见）
 * - 校验 JSON 根节点必须为普通对象
 * - 支持严格模式（拒绝未知顶层键及配置文件内嵌套 `config` 键）
 * - 提供非抛出版本 `loadUserConfigFile()` 供默认启动路径与向后兼容调用
 */

import {existsSync, readFileSync} from 'node:fs';

import {type ConfigLocator, defaultConfigLocator} from './ConfigLocator.js';
import {CONFIG_OPTIONS} from './options.js';
import {type GlobalConfig, validateGlobalConfig} from './schema.js';

const KNOWN_GLOBAL_CONFIG_KEYS = new Set<string>(Object.keys(CONFIG_OPTIONS));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ParseConfigFileOptions {
  /**
   * 严格模式：拒绝未知顶层配置键及配置文件内嵌套的 `config` 键。
   * 显式 `--config` 文件或热重载校验时建议开启。
   */
  strict?: boolean;
}

/**
 * 解析 JSON 配置文件原文并做 schema 校验。非法时抛出明确错误。
 */
export function parseConfigFileContent(
  rawContent: string,
  options: ParseConfigFileOptions = {},
): GlobalConfig {
  // 剥离 UTF-8 BOM（Windows PowerShell 默认带 BOM，JSON.parse 会报错）
  const normalized = rawContent.replace(/^\uFEFF/, '');
  const parsed: unknown = JSON.parse(normalized);

  if (!isPlainObject(parsed)) {
    throw new Error('Config must be a JSON object');
  }

  if (options.strict) {
    if ('config' in parsed) {
      throw new Error('Option "config" cannot be specified inside a config file');
    }
    const unknownKeys = Object.keys(parsed).filter(
      key => !KNOWN_GLOBAL_CONFIG_KEYS.has(key),
    );
    if (unknownKeys.length > 0) {
      throw new Error(`Unknown config option(s): ${unknownKeys.join(', ')}`);
    }
  }

  return validateGlobalConfig(parsed);
}

/**
 * 读取并解析指定配置文件（支持传入已读取的 `rawContent`，供 `ConfigWatcher` 复用）。
 */
export function parseConfigFile(
  configPath: string,
  rawContent?: string,
  options: ParseConfigFileOptions = {},
): GlobalConfig {
  try {
    const content = rawContent ?? readFileSync(configPath, 'utf-8');
    return parseConfigFileContent(content, options);
  } catch (err) {
    throw new Error(`Invalid JSON config file: ${getErrorMessage(err)}`);
  }
}

export interface LoadUserConfigOptions {
  locator?: ConfigLocator;
  env?: NodeJS.ProcessEnv;
}

/**
 * 安全加载用户级配置文件（文件不存在、空文件或损坏时返回 `{}` 并打印警告）。
 * 若未传入 `filePath`，通过 `ConfigLocator` 按优先级发现首个存在的配置文件。
 */
export function loadUserConfigFile(
  filePath?: string,
  options: LoadUserConfigOptions = {},
): GlobalConfig {
  const locator = options.locator ?? defaultConfigLocator;
  const resolvedPath = filePath ?? locator.locate(options.env);
  if (!resolvedPath) {
    return {};
  }

  try {
    if (!existsSync(resolvedPath)) {
      return {};
    }
    const content = readFileSync(resolvedPath, 'utf-8')
      .replace(/^\uFEFF/, '')
      .trim();
    if (!content) {
      return {};
    }
    return parseConfigFileContent(content);
  } catch (error) {
    console.warn(
      `[Config] 读取配置文件失败: ${resolvedPath} — ${getErrorMessage(error)}`,
    );
    return {};
  }
}
