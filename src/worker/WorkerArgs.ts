/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CONFIG_OPTIONS,
  toKebabCase,
  type ConfigOptionMeta,
} from '../config/options.js';
import type {GlobalConfig} from '../config.js';
import type {WorkerStartOptions} from '../types/platform.js';

type ResolvedWorkerConfig = Required<Pick<WorkerStartOptions, 'headless'>> &
  Pick<WorkerStartOptions, 'browserUrl' | 'wsEndpoint' | 'executablePath'>;

const BOOLEAN_FLAG_MAP: Record<string, keyof GlobalConfig> = {};
const VALUE_FLAG_MAP: Record<string, keyof GlobalConfig> = {};
const ARRAY_FLAG_MAP: Record<string, keyof GlobalConfig> = {};

/** 仅由 config.json / 内部承载、不作为 CLI flag 解析的复合字段 */
const NON_CLI_CONFIG_KEYS = new Set<keyof GlobalConfig>([
  'browser',
  'toolResultRecording',
  'runtimeDirName',
  'debug',
  'logLevel',
  'outputDir',
]);

for (const [key, meta] of Object.entries(CONFIG_OPTIONS) as Array<
  [keyof GlobalConfig, ConfigOptionMeta]
>) {
  if (NON_CLI_CONFIG_KEYS.has(key)) continue;

  const targetMap =
    meta.type === 'boolean'
      ? BOOLEAN_FLAG_MAP
      : meta.type === 'array'
        ? ARRAY_FLAG_MAP
        : VALUE_FLAG_MAP;

  const camelFlag = `--${String(key).toLowerCase()}`;
  const kebabFlag = `--${toKebabCase(String(key)).toLowerCase()}`;
  targetMap[camelFlag] = key;
  targetMap[kebabFlag] = key;

  if (meta.alias) {
    const aliases = Array.isArray(meta.alias) ? meta.alias : [meta.alias];
    for (const alias of aliases) {
      const flag = alias.length === 1 ? `-${alias}` : `--${alias.toLowerCase()}`;
      targetMap[flag] = key;
    }
  }
}

function normalizeKey(flag: string): string {
  return flag.toLowerCase();
}

/**
 * 解析 Worker 命令行参数为 GlobalConfig 格式。
 */
export function parseWorkerArgs(args: string[]): GlobalConfig {
  const cliConfig: GlobalConfig = {};

  for (let i = 0; i < args.length; i++) {
    const rawArg = args[i];
    let flag = rawArg;
    let inlineValue: string | undefined;

    const eq = rawArg.indexOf('=');
    if (eq > 0) {
      flag = rawArg.slice(0, eq);
      if (eq + 1 < rawArg.length) {
        inlineValue = rawArg.slice(eq + 1);
      } else {
        console.warn(`[Worker] 参数 ${rawArg} 缺少值，已忽略`);
        continue;
      }
    }

    const norm = normalizeKey(flag);

    // 1. 检查布尔参数取反形式 (--no-xxx)
    if (norm.startsWith('--no-')) {
      const positiveNorm = '--' + norm.slice(5);
      const boolKey = BOOLEAN_FLAG_MAP[positiveNorm];
      if (boolKey) {
        (cliConfig as Record<string, unknown>)[boolKey] = false;
        continue;
      }
    }

    // 2. 检查普通布尔参数
    const boolKey = BOOLEAN_FLAG_MAP[norm];
    if (boolKey) {
      if (inlineValue !== undefined) {
        const valLower = inlineValue.toLowerCase();
        (cliConfig as Record<string, unknown>)[boolKey] = !(
          valLower === 'false' ||
          valLower === '0' ||
          valLower === 'no' ||
          valLower === 'off'
        );
      } else {
        (cliConfig as Record<string, unknown>)[boolKey] = true;
      }
      continue;
    }

    // 3. 检查数组参数
    const arrayKey = ARRAY_FLAG_MAP[norm];
    if (arrayKey) {
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          console.warn(`[Worker] 参数 ${rawArg} 缺少值，已忽略`);
          continue;
        }
        value = args[++i];
      }
      const existing = (cliConfig as Record<string, unknown>)[arrayKey];
      const items = Array.isArray(existing) ? existing : [];
      // 允许逗号分隔传入多个
      items.push(
        ...value
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      );
      (cliConfig as Record<string, unknown>)[arrayKey] = items;
      continue;
    }

    // 4. 检查单值参数
    const valueKey = VALUE_FLAG_MAP[norm];
    if (valueKey) {
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          console.warn(`[Worker] 参数 ${rawArg} 缺少值，已忽略`);
          continue;
        }
        value = args[++i];
      }
      (cliConfig as Record<string, unknown>)[valueKey] = value as never;
      continue;
    }

    console.warn(`[Worker] 未知参数: ${rawArg}，已忽略`);
  }

  return cliConfig;
}

/**
 * 将 ResolvedConfig 转换为 WorkerStartOptions。
 */
export function toWorkerOptions(
  resolved: ResolvedWorkerConfig,
): WorkerStartOptions {
  const {browserUrl, executablePath, headless, wsEndpoint} = resolved;
  return {
    browserUrl,
    executablePath,
    headless,
    wsEndpoint,
  };
}
