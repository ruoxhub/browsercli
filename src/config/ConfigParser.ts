/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置文件与 CLI 参数解析器（参考 chrome-devtools-mcp/src/config/ConfigParser.ts）。
 *
 * 独立于 RuntimeConfigStore 和 resolver，作为纯 L0 基础设施：
 * - 统一处理 UTF-8 BOM（Windows PowerShell 5.1 写盘常见）
 * - 校验 JSON 根节点必须为普通对象
 * - 严格模式通过 yargs 拒绝未知顶层键/保留键（`config`/`help`/`version`）并执行 `coerce`/`choices` 校验
 * - 提供 `ConfigParser` 类（支持 `parseCliArgs`、`parseConfigFile`、`parseConfig`、`reloadConfig`）
 * - 保留非抛出版本 `loadUserConfigFile()` 供默认启动路径与向后兼容调用
 */

import {existsSync, readFileSync} from 'node:fs';

import type {Argv} from 'yargs';

import {hideBin, yargs, type YargsOptions} from '../third_party/index.js';

import {ConfigLocator, defaultConfigLocator} from './ConfigLocator.js';
import {type GlobalConfig, validateGlobalConfig} from './schema.js';
import {
  CLI_EXAMPLES,
  getKnownConfigKeys,
  serverOptions,
  stripYargsPositionalArgs,
  withoutDefaults,
} from './server-options.js';
import {ServerConfig} from './ServerConfig.js';

const KNOWN_GLOBAL_CONFIG_KEYS = getKnownConfigKeys();
const FORBIDDEN_FILE_KEYS = new Set(['config', 'help', 'version']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ParseConfigFileOptions {
  /**
   * 严格模式：拒绝未知顶层配置键、保留键（`config`/`help`/`version`），
   * 并通过 yargs 执行 `coerce`/`choices` 校验。
   * 显式 `--config` 文件或热重载校验时建议开启。
   */
  strict?: boolean;
}

/**
 * 解析 JSON 配置文件原文并做校验。非法时抛出明确错误。
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
    for (const key of Object.keys(parsed)) {
      if (FORBIDDEN_FILE_KEYS.has(key)) {
        throw new Error(
          `Option "${key}" cannot be specified inside a config file`,
        );
      }
    }
    const unknownKeys = Object.keys(parsed).filter(
      key => !KNOWN_GLOBAL_CONFIG_KEYS.has(key),
    );
    if (unknownKeys.length > 0) {
      throw new Error(`Unknown config option(s): ${unknownKeys.join(', ')}`);
    }

    const configOptions = withoutDefaults(serverOptions);
    delete configOptions.config;
    const yargsParsed = yargs([])
      .parserConfiguration({
        'strip-aliased': true,
        'camel-case-expansion': false,
      })
      .options(configOptions)
      .help(false)
      .version(false)
      .config(parsed)
      .strict()
      .fail(false)
      .exitProcess(false)
      .parseSync([]);
    return validateGlobalConfig(stripYargsPositionalArgs(yargsParsed));
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

export class ConfigParser {
  #configPath?: string;
  #cliArgs?: Partial<GlobalConfig>;
  #usageStatisticsNoticeShown = false;
  readonly configLocator: ConfigLocator;

  constructor(
    private version: string,
    private argv: string[] = process.argv,
    private env: NodeJS.ProcessEnv = process.env,
    private exitProcess = true,
    configLocator?: ConfigLocator,
  ) {
    this.configLocator = configLocator ?? new ConfigLocator();
  }

  /**
   * 最近一次 `parse()` / `parseConfig()` 定位到的配置文件路径。
   */
  get configPath(): string | undefined {
    return this.#configPath;
  }

  buildCliParser(options: Record<string, YargsOptions> = serverOptions): Argv {
    const yargsInstance = yargs(hideBin(this.argv));
    return yargsInstance
      .scriptName('browsercli')
      .parserConfiguration({
        'strip-aliased': true,
        'strip-dashed': true,
      })
      .options(options)
      .showHelpOnFail(false, 'Specify --help for available options')
      .example(CLI_EXAMPLES)
      .wrap(Math.min(120, yargsInstance.terminalWidth()))
      .help()
      .version(this.version);
  }

  /**
   * Step 1: 仅解析用户显式传入的 CLI flag（不注入默认值）。
   */
  parseCliArgs(): Partial<GlobalConfig> {
    const parsed = this.buildCliParser(withoutDefaults(serverOptions))
      .fail(false)
      .exitProcess(this.exitProcess)
      .parseSync();
    return stripYargsPositionalArgs(parsed) as Partial<GlobalConfig>;
  }

  /**
   * Step 2: 读取并解析 JSON 配置文件（默认开启严格校验，拒绝未知键并执行 coerce）。
   */
  static parseConfigFile(
    configPath: string,
    rawContent?: string,
    options: ParseConfigFileOptions = {strict: true},
  ): GlobalConfig {
    return parseConfigFile(configPath, rawContent, options);
  }

  parseConfigFile(
    configPath: string,
    rawContent?: string,
    options: ParseConfigFileOptions = {strict: true},
  ): GlobalConfig {
    return ConfigParser.parseConfigFile(configPath, rawContent, options);
  }

  warnUnknownArgs(cliArgs: Partial<GlobalConfig>): void {
    const allowedArgs = new Set(Object.keys(serverOptions));
    const unknownArgs = Object.keys(cliArgs).filter(
      arg => !allowedArgs.has(arg),
    );
    if (unknownArgs.length > 0) {
      console.error(`Unknown arguments: ${unknownArgs.map(arg => `--${arg}`)}`);
    }
  }

  /**
   * 解析 CLI 参数与配置文件，返回分层 `ServerConfig`。
   */
  parseConfig(): ServerConfig {
    try {
      const cliArgs = this.parseCliArgs();
      this.#cliArgs = cliArgs;
      this.#configPath = cliArgs.config ?? this.configLocator.locate(this.env);
      this.warnUnknownArgs(cliArgs);
      return this.#resolveConfig(cliArgs);
    } catch (error) {
      if (this.exitProcess) {
        console.error(getErrorMessage(error));
        process.exit(1);
      }
      throw error;
    }
  }

  parse(): GlobalConfig {
    return this.parseConfig().resolved;
  }

  /**
   * 重新读取已定位的配置文件并与 CLI 参数重新合并；不重新做文件发现，失败时抛出错误。
   */
  reloadConfig(): ServerConfig {
    this.#cliArgs ??= this.parseCliArgs();
    return this.#resolveConfig(this.#cliArgs);
  }

  reload(): GlobalConfig {
    return this.reloadConfig().resolved;
  }

  #resolveConfig(cliArgs: Partial<GlobalConfig>): ServerConfig {
    const configPath = this.#configPath;
    const fileArgs = configPath ? this.parseConfigFile(configPath) : {};
    const config = ServerConfig.create({
      cliArgs,
      fileArgs,
      configPath,
      env: this.env,
      suppressUsageStatisticsNotice: this.#usageStatisticsNoticeShown,
    });
    this.#usageStatisticsNoticeShown = true;
    return config;
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
