/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 扩展子命令（config）的精简实现。
 */

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

import {isOutputFormat} from './formatResponse.js';
import {cliConfigPath, loadCliConfig, type CliConfig} from './sessionPaths.js';
import {CliError} from './toolInvoke.js';

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const VALID_CONFIG_KEYS = new Set<string>([
  'workerEntry',
  'headless',
  'cloak',
  'jsStealth',
  'fullStealthArgs',
  'minimalStealth',
  'browserUrl',
  'wsEndpoint',
  'executablePath',
  'isolate_workspace',
  'outputFormat',
]);

function validateConfigKey(key: string): void {
  if (VALID_CONFIG_KEYS.has(key)) return;
  throw new CliError(`未知配置键：${key}`, 'VALIDATION_ERROR', [
    '合法的键：' + [...VALID_CONFIG_KEYS].join(', '),
  ]);
}

function writeCliConfig(config: CliConfig): void {
  const target = cliConfigPath();
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, JSON.stringify(config, null, 2), 'utf8');
}

function mergedConfig(): CliConfig {
  const file = loadCliConfig();
  return {
    ...file,
    workerEntry:
      process.env.BROWSERCLI_ENTRY ??
      process.env.PROXYCLI_ENTRY ??
      file.workerEntry,
  };
}

export function runConfig(opts: {
  init?: boolean;
  set?: string;
  get?: string;
  unset?: string;
  list?: boolean;
  action?: string;
  arg?: string;
}): Record<string, unknown> {
  const setRaw = opts.set ?? (opts.action === 'set' ? opts.arg : undefined);
  const getKey = opts.get ?? (opts.action === 'get' ? opts.arg : undefined);
  const unsetKey =
    opts.unset ?? (opts.action === 'unset' ? opts.arg : undefined);

  if (opts.init || opts.action === 'init') {
    const filePath = cliConfigPath();
    const created = !existsSync(filePath);
    if (created) writeCliConfig({});
    return {action: 'init', path: filePath, created};
  }

  if (setRaw !== undefined) {
    const eq = setRaw.indexOf('=');
    if (eq === -1) {
      throw new CliError(`--set 格式错误：${setRaw}`, 'VALIDATION_ERROR', [
        '正确格式：--set key=value',
      ]);
    }
    const key = setRaw.slice(0, eq);
    const value = setRaw.slice(eq + 1);
    validateConfigKey(key);
    if (key === 'outputFormat' && !isOutputFormat(value)) {
      throw new CliError(
        `无效的 outputFormat 值：${value}（支持 md、json 或 toon）`,
        'VALIDATION_ERROR',
      );
    }
    const config = loadCliConfig();
    (config as Record<string, string>)[key] = value;
    writeCliConfig(config);
    return {action: 'set', key, value, path: cliConfigPath()};
  }

  if (getKey !== undefined) {
    validateConfigKey(getKey);
    const resolved = mergedConfig();
    return {
      action: 'get',
      key: getKey,
      value: (resolved as Record<string, unknown>)[getKey] ?? null,
    };
  }

  if (unsetKey !== undefined) {
    validateConfigKey(unsetKey);
    const config = loadCliConfig();
    const deleted = unsetKey in config;
    delete (config as Record<string, unknown>)[unsetKey];
    writeCliConfig(config);
    return {action: 'unset', key: unsetKey, deleted, path: cliConfigPath()};
  }

  const filePath = cliConfigPath();
  const envOverrides = Object.keys(process.env).filter(
    k => k === 'BROWSERCLI_ENTRY' || k === 'PROXYCLI_ENTRY',
  );
  if (opts.list || opts.action === 'list') {
    return {
      action: 'list',
      path: filePath,
      exists: existsSync(filePath),
      envOverrides,
    };
  }

  return {
    action: 'show',
    resolved: mergedConfig(),
    file: filePath,
    envOverrides,
  };
}
