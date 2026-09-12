/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {GlobalConfig} from '../config.js';
import type {WorkerStartOptions} from '../types/platform.js';

type ResolvedWorkerConfig = Required<Pick<WorkerStartOptions, 'headless'>> &
  Pick<WorkerStartOptions, 'browserUrl' | 'wsEndpoint' | 'executablePath'>;

const BOOLEAN_FLAGS: Record<string, keyof GlobalConfig> = {
  '--headless': 'headless',
  '--cloak': 'cloak',
  '--js-stealth': 'jsStealth',
  '--full-stealth-args': 'fullStealthArgs',
};

const VALUE_FLAGS: Record<string, keyof GlobalConfig> = {
  '--browserUrl': 'browserUrl',
  '--executablePath': 'executablePath',
  '--wsEndpoint': 'wsEndpoint',
};

/**
 * 解析 Worker 命令行参数为 GlobalConfig 格式。
 */
export function parseWorkerArgs(args: string[]): GlobalConfig {
  const cliConfig: GlobalConfig = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const boolKey = BOOLEAN_FLAGS[arg];
    if (boolKey) {
      (cliConfig as Record<string, unknown>)[boolKey] = true;
      continue;
    }

    const targetKey = VALUE_FLAGS[arg];
    if (!targetKey) {
      // 兼容 CLI 侧 `--flag=value` 形态（daemon spawn 白名单要求 `=` 形态）
      const eq = arg.indexOf('=');
      const inlineKey = eq > 0 ? VALUE_FLAGS[arg.slice(0, eq)] : undefined;
      if (inlineKey) {
        if (eq + 1 < arg.length) {
          cliConfig[inlineKey] = arg.slice(eq + 1) as never;
        } else {
          console.warn(`[Worker] 参数 ${arg} 缺少值，已忽略`);
        }
        continue;
      }
      console.warn(`[Worker] 未知参数: ${arg}，已忽略`);
      continue;
    }

    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
      console.warn(`[Worker] 参数 ${arg} 缺少值，已忽略`);
      continue;
    }

    cliConfig[targetKey] = args[++i] as never;
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
