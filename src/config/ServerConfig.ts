/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 分层配置容器（参考 chrome-devtools-mcp/src/config/ServerConfig.ts）。
 *
 * 将各配置来源独立分层保存，合并优先级（高 → 低）：
 *   `CLI > 环境变量 > 配置文件 > 持久化运行缓存 (runtime-config.json) > 默认值`
 *
 * 核心能力：
 * - `validateConflicts` / `validateImplications`：仅对显式输入做冲突与依赖检查，默认值绝不误报冲突
 * - `applyDefaults`：基于 `viaCli` 与环境变量填充默认值，并处理衍生默认值（如 `channel`、`isolated`、`filesystemRoot`）
 * - `withFileArgs(nextFileArgs)`：用新配置文件重算候选配置，同时严格保留 CLI / env / cached 层
 * - `mergeReloadable(next)`：仅合并支持热重载（`reloadable: true`）的字段，保持需重启字段不变并重新校验冲突
 * - `getRestartRequiredChanges(next)`：找出已变更且需重启 daemon 才能生效的选项清单
 * - `commit(next)`：原地原子提交，使所有持有 `ReadonlyServerConfig` 引用的组件立即可见新快照
 */

import {isDeepStrictEqual} from 'node:util';

import {yargs} from '../third_party/index.js';

import {type GlobalConfig, validateGlobalConfig} from './schema.js';
import {
  DEFAULT_FILESYSTEM_ROOT,
  isReloadableOption,
  type ServerOptions,
  serverOptions,
  serverOptionsForViaCli,
  stripYargsPositionalArgs,
  validateConfigConflicts,
  validateConfigImplications,
} from './server-options.js';

const DEEP_MERGE_KEYS = new Set<keyof GlobalConfig>([
  'browser',
  'toolResultRecording',
]);

const KNOWN_CONFIG_KEYS = new Set<string>(Object.keys(serverOptions));

function isKnownConfigKey(key: string): key is keyof ServerOptions {
  return KNOWN_CONFIG_KEYS.has(key);
}

function copyOption<K extends keyof GlobalConfig>(
  target: Partial<GlobalConfig>,
  source: Readonly<Partial<GlobalConfig>>,
  key: K,
): void {
  if (key in source && source[key] !== undefined) {
    target[key] = source[key];
  } else {
    delete target[key];
  }
}

function filterExplicitArgs(
  args: Partial<GlobalConfig>,
  baseOptions: ServerOptions,
): Partial<GlobalConfig> {
  const filtered: Partial<GlobalConfig> = {};
  for (const key of Object.keys(args)) {
    if (!isKnownConfigKey(key)) {
      continue;
    }
    const typedKey = key as keyof GlobalConfig;
    const option = baseOptions[key];
    if (
      args[typedKey] === undefined &&
      option !== undefined &&
      'default' in option
    ) {
      continue;
    }
    copyOption(filtered, args, typedKey);
  }
  return filtered;
}

function mergeReloadableLayer(
  previous: Readonly<Partial<GlobalConfig>>,
  next: Readonly<Partial<GlobalConfig>>,
): Partial<GlobalConfig> {
  const merged: Partial<GlobalConfig> = {...previous};
  for (const name of Object.keys(serverOptions)) {
    if (isKnownConfigKey(name) && isReloadableOption(name)) {
      copyOption(merged, next, name as keyof GlobalConfig);
    }
  }
  return merged;
}

function parseDefaultArgs(options: ServerOptions): GlobalConfig {
  const parsed = yargs([])
    .parserConfiguration({
      'strip-aliased': true,
      'camel-case-expansion': false,
    })
    .options(options)
    .parseSync([]);
  return {
    ...(stripYargsPositionalArgs(parsed) as Partial<GlobalConfig>),
    // yargs copies array defaults, so restore the shared reference that the
    // `viaCli` check in `applyDefaults()` compares with `===`.
    filesystemRoot: DEFAULT_FILESYSTEM_ROOT,
  };
}

/**
 * 按顺序合并多层配置，对 `browser` / `toolResultRecording` 执行浅合并（保留低层未被覆盖的子键）。
 */
function mergeConfigLayers(
  ...layers: Array<Readonly<Partial<GlobalConfig>> | undefined>
): GlobalConfig {
  const merged: GlobalConfig = {};

  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const typedKey = key as keyof GlobalConfig;
      if (
        DEEP_MERGE_KEYS.has(typedKey) &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const prev = (merged as Record<string, unknown>)[key];
        (merged as Record<string, unknown>)[key] =
          prev && typeof prev === 'object' && !Array.isArray(prev)
            ? {...(prev as object), ...(value as object)}
            : {...(value as object)};
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return merged;
}

export interface ReadonlyServerConfig {
  readonly resolved: Readonly<GlobalConfig>;
  readonly configPath?: string;
}

export interface ServerConfigInit {
  cliArgs: Partial<GlobalConfig>;
  envArgs?: Partial<GlobalConfig>;
  fileArgs: Partial<GlobalConfig>;
  cachedArgs?: Partial<GlobalConfig>;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  resolved: GlobalConfig;
}

export interface ServerConfigCreateOptions {
  cliArgs?: Partial<GlobalConfig>;
  envArgs?: Partial<GlobalConfig>;
  fileArgs?: Partial<GlobalConfig>;
  cachedArgs?: Partial<GlobalConfig>;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  suppressUsageStatisticsNotice?: boolean;
  /** 是否执行互斥与依赖蕴含校验（默认 true）。 */
  validate?: boolean;
  /** 是否填充默认值（默认 true）。 */
  applyDefaults?: boolean;
}

export class ServerConfig implements ReadonlyServerConfig {
  #cliArgs: Readonly<Partial<GlobalConfig>>;
  #envArgs: Readonly<Partial<GlobalConfig>>;
  #fileArgs: Readonly<Partial<GlobalConfig>>;
  #cachedArgs: Readonly<Partial<GlobalConfig>>;
  readonly #configPath?: string;
  readonly #env: NodeJS.ProcessEnv;
  #resolved: Readonly<GlobalConfig>;

  constructor(init: ServerConfigInit) {
    this.#cliArgs = {...init.cliArgs};
    this.#envArgs = {...(init.envArgs ?? {})};
    this.#fileArgs = {...init.fileArgs};
    this.#cachedArgs = {...(init.cachedArgs ?? {})};
    this.#configPath = init.configPath;
    this.#env = init.env ?? process.env;
    this.#resolved = {...init.resolved};
  }

  /**
   * Step 4a: 拒绝互斥输入。仅检查显式传入的激活值，默认值不会触发冲突。
   */
  static validateConflicts(explicitArgs: Partial<GlobalConfig>): void {
    validateConfigConflicts(explicitArgs);
  }

  /**
   * Step 4b: 校验依赖蕴含规则（例如 `wsHeaders -> wsEndpoint`）。
   */
  static validateImplications(explicitArgs: Partial<GlobalConfig>): void {
    validateConfigImplications(explicitArgs);
  }

  /**
   * Step 5: 为所有未显式设置的选项填充默认值。
   * `viaCli` 作为显式输入决定默认选项集与上下文衍生规则。
   */
  static applyDefaults(
    explicitArgs: Partial<GlobalConfig>,
    options?: {
      env?: NodeJS.ProcessEnv;
      suppressUsageStatisticsNotice?: boolean;
    },
  ): GlobalConfig {
    const env = options?.env ?? process.env;
    const isViaCli = explicitArgs.viaCli === true;
    const baseOptions = isViaCli ? serverOptionsForViaCli : serverOptions;
    const resolvedArgs = mergeConfigLayers(
      parseDefaultArgs(baseOptions),
      filterExplicitArgs(explicitArgs, baseOptions),
    );

    // `channel` 仅在按渠道启动本地浏览器时保留默认值，其余连接模式下删除以便于遥测/diff。
    const launchesByChannel =
      !resolvedArgs.browserUrl &&
      !resolvedArgs.wsEndpoint &&
      !resolvedArgs.executablePath &&
      !resolvedArgs.browser?.browserURL &&
      !resolvedArgs.browser?.wsEndpoint &&
      !resolvedArgs.browser?.executablePath;
    if (
      !launchesByChannel &&
      explicitArgs.channel === undefined &&
      explicitArgs.browser?.channel === undefined
    ) {
      delete resolvedArgs.channel;
    }

    if (isViaCli) {
      resolvedArgs.pageIdRouting = true;
      if (
        resolvedArgs.filesystemRoot === DEFAULT_FILESYSTEM_ROOT &&
        explicitArgs.allowUnrestrictedPaths !== false
      ) {
        resolvedArgs.allowUnrestrictedPaths = true;
        resolvedArgs.filesystemRoot = undefined;
      }
      const connectsToExistingBrowser = Boolean(
        resolvedArgs.autoConnect ||
        resolvedArgs.browserUrl ||
        resolvedArgs.wsEndpoint ||
        resolvedArgs.browser?.autoConnect ||
        resolvedArgs.browser?.browserURL ||
        resolvedArgs.browser?.wsEndpoint,
      );
      if (
        explicitArgs.isolated === undefined &&
        resolvedArgs.userDataDir === undefined &&
        !connectsToExistingBrowser
      ) {
        resolvedArgs.isolated = true;
      }
      if (
        resolvedArgs.categoryExtensions === undefined &&
        !connectsToExistingBrowser
      ) {
        resolvedArgs.categoryExtensions = true;
      }
    }

    if (env['CI'] || env['BROWSERCLI_NO_USAGE_STATISTICS']) {
      if (!options?.suppressUsageStatisticsNotice) {
        console.error(
          "turning off usage statistics. process.env['CI'] || process.env['BROWSERCLI_NO_USAGE_STATISTICS'] is set.",
        );
      }
      resolvedArgs.usageStatistics = false;
    }

    if (
      resolvedArgs.categoryExperimentalThirdParty === undefined &&
      env['BROWSERCLI_CATEGORY_EXPERIMENTAL_THIRD_PARTY']
    ) {
      resolvedArgs.categoryExperimentalThirdParty = true;
    }

    const keepDefaultFilesystemRootRef =
      resolvedArgs.filesystemRoot === DEFAULT_FILESYSTEM_ROOT;
    const validated = validateGlobalConfig(resolvedArgs);
    if (keepDefaultFilesystemRootRef) {
      validated.filesystemRoot = DEFAULT_FILESYSTEM_ROOT;
    }
    return validated;
  }

  /**
   * Step 3–5: 合并分层输入（`CLI > env > file > cached`），校验冲突与依赖，并应用默认值。
   * 注意：`cachedArgs` 属于历史运行态回填缓存，不参与用户显式输入冲突校验。
   */
  static create(options: ServerConfigCreateOptions = {}): ServerConfig {
    const cliArgs = options.cliArgs ? {...options.cliArgs} : {};
    const envArgs = options.envArgs ? {...options.envArgs} : {};
    const fileArgs = options.fileArgs ? {...options.fileArgs} : {};
    const cachedArgs = options.cachedArgs ? {...options.cachedArgs} : {};

    const explicitMerged = mergeConfigLayers(
      fileArgs,
      envArgs,
      cliArgs,
      options.configPath ? {config: options.configPath} : undefined,
    );

    if (options.validate !== false) {
      ServerConfig.validateConflicts(explicitMerged);
      ServerConfig.validateImplications(explicitMerged);
    }

    const combined = mergeConfigLayers(cachedArgs, explicitMerged);
    const resolved =
      options.applyDefaults === false
        ? validateGlobalConfig(combined)
        : ServerConfig.applyDefaults(combined, {
            env: options.env,
            suppressUsageStatisticsNotice:
              options.suppressUsageStatisticsNotice,
          });

    return new ServerConfig({
      cliArgs,
      envArgs,
      fileArgs,
      cachedArgs,
      configPath: options.configPath,
      env: options.env,
      resolved,
    });
  }

  get cliArgs(): Readonly<Partial<GlobalConfig>> {
    return this.#cliArgs;
  }

  get envArgs(): Readonly<Partial<GlobalConfig>> {
    return this.#envArgs;
  }

  get fileArgs(): Readonly<Partial<GlobalConfig>> {
    return this.#fileArgs;
  }

  get cachedArgs(): Readonly<Partial<GlobalConfig>> {
    return this.#cachedArgs;
  }

  get configPath(): string | undefined {
    return this.#configPath;
  }

  get resolved(): Readonly<GlobalConfig> {
    return this.#resolved;
  }

  /**
   * 基于新的配置文件内容生成候选 `ServerConfig`，完整保留原有的 CLI、env、cached 层与环境变量。
   */
  withFileArgs(fileArgs: Partial<GlobalConfig>): ServerConfig {
    return ServerConfig.create({
      cliArgs: {...this.#cliArgs},
      envArgs: {...this.#envArgs},
      fileArgs,
      cachedArgs: {...this.#cachedArgs},
      configPath: this.#configPath,
      env: this.#env,
      suppressUsageStatisticsNotice: true,
    });
  }

  /**
   * 仅从 `next` 吸收支持热重载（`reloadable: true`）的选项，保持需重启选项来自当前配置，
   * 并在合并后重新执行冲突与依赖校验，始终维护 `CLI > env > file > cached > defaults` 优先级。
   */
  mergeReloadable(
    next: ServerConfig,
    options?: {env?: NodeJS.ProcessEnv},
  ): ServerConfig {
    const mergedFileArgs = mergeReloadableLayer(this.#fileArgs, next.#fileArgs);
    const mergedEnvArgs = mergeReloadableLayer(this.#envArgs, next.#envArgs);
    const mergedCliArgs = mergeReloadableLayer(this.#cliArgs, next.#cliArgs);
    return ServerConfig.create({
      cliArgs: mergedCliArgs,
      envArgs: mergedEnvArgs,
      fileArgs: mergedFileArgs,
      cachedArgs: {...this.#cachedArgs},
      configPath: this.#configPath,
      env: options?.env ?? this.#env,
      suppressUsageStatisticsNotice: true,
    });
  }

  /**
   * 返回在当前配置与 `next` 之间发生变化的「需重启」选项键名列表（按字典序稳定返回）。
   */
  getRestartRequiredChanges(next: ServerConfig): Array<keyof GlobalConfig> {
    const changed: Array<keyof GlobalConfig> = [];
    for (const name of Object.keys(serverOptions)) {
      if (!isKnownConfigKey(name) || isReloadableOption(name)) {
        continue;
      }
      const typedName = name as keyof GlobalConfig;
      if (
        (!isDeepStrictEqual(
          this.#fileArgs[typedName],
          next.#fileArgs[typedName],
        ) ||
          !isDeepStrictEqual(
            this.#envArgs[typedName],
            next.#envArgs[typedName],
          ) ||
          !isDeepStrictEqual(
            this.#cliArgs[typedName],
            next.#cliArgs[typedName],
          )) &&
        !isDeepStrictEqual(this.#resolved[typedName], next.#resolved[typedName])
      ) {
        changed.push(typedName);
      }
    }
    return changed.sort();
  }

  /**
   * 原地原子提交已校验的 `ServerConfig` 快照，使所有 `ReadonlyServerConfig` 读取方立即可见。
   */
  commit(next: ServerConfig): void {
    this.#cliArgs = next.#cliArgs;
    this.#envArgs = next.#envArgs;
    this.#fileArgs = next.#fileArgs;
    this.#cachedArgs = next.#cachedArgs;
    this.#resolved = next.#resolved;
  }
}
