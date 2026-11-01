/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 服务配置 — Browser / System 配置读取与工厂函数
 *
 * 从 resolver.ts 拆分而来，集中管理浏览器管理器相关的配置读取逻辑。
 * 核心配置基础设施（文件读写、环境变量工具、resolveConfig）
 * 仍保留在 resolver.ts 中。
 */

import type {BrowserManagerConfig} from '../types/browser.js';
import {type SourceMapConfig, SourceMapError} from '../types/sourcemap.js';

import {getEnvBoolean, getEnvNumber, getEnvValue} from './resolver.js';
import {getRuntimeConfigStore} from './RuntimeConfigStore.js';
import {
  type SystemConfig,
  SystemConfigSchema,
  validateSystemConfig,
} from './schema.js';

// ==========================================================================
// Browser / System 配置
// ==========================================================================

function getBoundedPositiveInteger(
  key: string,
  defaultValue: number,
  maximum: number,
): number {
  const value = getEnvNumber(key, defaultValue);
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new SourceMapError(
      'SOURCEMAP_CONFIG_INVALID',
      `${key} must be a positive integer no greater than ${maximum}`,
    );
  }
  return value;
}

export function getSourceMapConfig(): SourceMapConfig {
  const maxBytes = getBoundedPositiveInteger(
    'SOURCEMAP_MAX_BYTES',
    20 * 1024 * 1024,
    100 * 1024 * 1024,
  );
  const cacheMaxBytes = getBoundedPositiveInteger(
    'SOURCEMAP_CACHE_MAX_BYTES',
    64 * 1024 * 1024,
    256 * 1024 * 1024,
  );
  if (cacheMaxBytes < maxBytes) {
    throw new SourceMapError(
      'SOURCEMAP_CONFIG_INVALID',
      'SOURCEMAP_CACHE_MAX_BYTES must be at least SOURCEMAP_MAX_BYTES',
    );
  }
  return {
    maxBytes,
    cacheMaxBytes,
    cacheMaxEntries: getBoundedPositiveInteger(
      'SOURCEMAP_CACHE_MAX_ENTRIES',
      16,
      64,
    ),
    cacheTtlMs: getBoundedPositiveInteger(
      'SOURCEMAP_CACHE_TTL_MS',
      30 * 60 * 1000,
      24 * 60 * 60 * 1000,
    ),
    fetchTimeoutMs: getBoundedPositiveInteger(
      'SOURCEMAP_FETCH_TIMEOUT_MS',
      15_000,
      60_000,
    ),
    maxRedirects: 3,
    maxIndexedDepth: 8,
    maxIndexedSections: 1000,
    maxDiffChanges: 2000,
  };
}

/**
 * 环境变量 + 配置文件（RuntimeConfigStore 的 browser 字段）合并出来的浏览器配置。
 *
 * 优先级：环境变量 > RuntimeConfigStore 中的 browser 字段。
 */
export function buildBrowserManagerConfig(): BrowserManagerConfig {
  const fileConfig = getRuntimeConfigStore().get();
  const fileBrowser = fileConfig.browser;

  type ResolverKind = 'boolean' | 'number' | 'value';
  interface FieldDef {
    key: keyof BrowserManagerConfig;
    envKey: string;
    kind: ResolverKind;
    fileKey?: string;
    default?: boolean | number | string;
    extraFallback?: keyof typeof fileConfig;
    cast?: (v: string) => BrowserManagerConfig[keyof BrowserManagerConfig];
  }

  const fields: FieldDef[] = [
    {
      key: 'headless',
      envKey: 'BROWSER_HEADLESS',
      kind: 'boolean',
      default: true,
      extraFallback: 'headless',
    },
    {
      key: 'isolated',
      envKey: 'BROWSER_ISOLATED',
      kind: 'boolean',
      default: true,
    },
    {
      key: 'useStealthScripts',
      envKey: 'USE_STEALTH_SCRIPTS',
      kind: 'boolean',
      default: false,
    },
    {
      key: 'jsStealth',
      envKey: 'BROWSER_JS_STEALTH',
      kind: 'boolean',
      default: false,
      extraFallback: 'jsStealth',
    },
    {
      key: 'cloak',
      envKey: 'BROWSER_CLOAK',
      kind: 'boolean',
      default: false,
      extraFallback: 'cloak',
    },
    {
      key: 'fullStealthArgs',
      envKey: 'BROWSER_FULL_STEALTH_ARGS',
      kind: 'boolean',
      default: false,
      extraFallback: 'fullStealthArgs',
    },
    {
      key: 'minimalStealth',
      envKey: 'BROWSER_MINIMAL_STEALTH',
      kind: 'boolean',
      default: true,
      extraFallback: 'minimalStealth',
    },
    {
      key: 'executablePath',
      envKey: 'BROWSER_EXECUTABLE_PATH',
      kind: 'value',
      extraFallback: 'executablePath',
    },
    {
      key: 'channel',
      envKey: 'BROWSER_CHANNEL',
      kind: 'value',
      cast: v => v as BrowserManagerConfig['channel'],
    },
    {
      key: 'autoConnect',
      envKey: 'BROWSER_AUTO_CONNECT',
      kind: 'boolean',
      extraFallback: 'autoConnect',
    },
    {
      key: 'browserURL',
      envKey: 'BROWSER_URL',
      kind: 'value',
      extraFallback: 'browserUrl',
    },
    {
      key: 'wsEndpoint',
      envKey: 'BROWSER_WS_ENDPOINT',
      kind: 'value',
      extraFallback: 'wsEndpoint',
    },
    {key: 'remoteDebuggingUrl', envKey: 'REMOTE_DEBUGGING_URL', kind: 'value'},
    {
      key: 'remoteDebuggingPort',
      envKey: 'REMOTE_DEBUGGING_PORT',
      kind: 'number',
    },
    {key: 'userDataDir', envKey: 'BROWSER_USER_DATA_DIR', kind: 'value'},
    {key: 'browserPath', envKey: 'BROWSER_PATH', kind: 'value'},
    {key: 'userAgent', envKey: 'BROWSER_USER_AGENT', kind: 'value'},
    {
      key: 'acceptInsecureCerts',
      envKey: 'BROWSER_ACCEPT_INSECURE_CERTS',
      kind: 'boolean',
    },
    {key: 'devtools', envKey: 'BROWSER_DEVTOOLS', kind: 'boolean'},
    {key: 'autoLaunch', envKey: 'BROWSER_AUTO_LAUNCH', kind: 'boolean'},
    {
      key: 'waitForBrowserTimeoutMs',
      envKey: 'BROWSER_WAIT_TIMEOUT_MS',
      kind: 'number',
    },
    {
      key: 'waitForBrowserPollMs',
      envKey: 'BROWSER_WAIT_POLL_MS',
      kind: 'number',
    },
    {key: 'timeout', envKey: 'BROWSER_TIMEOUT', kind: 'number'},
    {
      key: 'maxCollectedUrls',
      envKey: 'BROWSER_MAX_COLLECTED_URLS',
      kind: 'number',
    },
    {
      key: 'maxFilesPerCollect',
      envKey: 'BROWSER_MAX_FILES_PER_COLLECT',
      kind: 'number',
    },
    {
      key: 'maxTotalContentSize',
      envKey: 'BROWSER_MAX_TOTAL_CONTENT_SIZE',
      kind: 'number',
    },
    {
      key: 'maxSingleFileSize',
      envKey: 'BROWSER_MAX_SINGLE_FILE_SIZE',
      kind: 'number',
    },
  ];

  const config: BrowserManagerConfig = {
    headless: true,
    isolated: true,
    useStealthScripts: false,
    jsStealth: false,
    cloak: false,
    fullStealthArgs: false,
    minimalStealth: true,
  };

  const getters = {
    boolean: getEnvBoolean,
    number: getEnvNumber,
    value: getEnvValue,
  };

  for (const field of fields) {
    const fbKey = field.fileKey ?? (field.key as string);
    const envVal = getters[field.kind](field.envKey) as unknown;
    const fileVal = fileBrowser?.[fbKey as keyof typeof fileBrowser] as unknown;
    const extraVal =
      field.extraFallback && fileConfig[field.extraFallback] !== undefined
        ? fileConfig[field.extraFallback]
        : undefined;

    const chosenVal =
      envVal !== undefined
        ? envVal
        : fileVal !== undefined
          ? fileVal
          : extraVal !== undefined
            ? extraVal
            : field.default;

    if (chosenVal !== undefined) {
      (config as Record<string, unknown>)[field.key as string] = field.cast
        ? field.cast(chosenVal as string)
        : chosenVal;
    }
  }

  const envWsHeaders = getEnvValue('BROWSER_WS_HEADERS');
  if (envWsHeaders) {
    try {
      config.wsHeaders = JSON.parse(
        envWsHeaders.replace(/^\uFEFF/, ''),
      ) as Record<string, string>;
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
 * 环境变量 / 配置文件合并后的浏览器配置。
 */
export function getBrowserManagerConfig(): BrowserManagerConfig {
  return buildBrowserManagerConfig();
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

  const errors = result.error.issues.map(issue => {
    const pathStr = issue.path.join('.');
    return `${pathStr}: ${issue.message}`;
  });

  return {
    valid: false,
    errors,
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
