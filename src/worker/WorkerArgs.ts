/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {GlobalConfig} from '../config.js';
import type {WorkerStartOptions} from '../types/platform.js';

type ResolvedWorkerConfig = Required<
  Pick<WorkerStartOptions, 'sekiroHost' | 'group' | 'headless'>
> &
  Pick<
    WorkerStartOptions,
    'browserUrl' | 'wsEndpoint' | 'executablePath' | 'databaseUrl'
  >;

const VALUE_FLAGS: Record<string, keyof GlobalConfig> = {
  '--browserUrl': 'browserUrl',
  '--databaseUrl': 'databaseUrl',
  '--executablePath': 'executablePath',
  '--group': 'group',
  '--sekiroHost': 'sekiroHost',
  '--wsEndpoint': 'wsEndpoint',
};

/**
 * 解析 Worker 命令行参数为 GlobalConfig 格式。
 */
export function parseWorkerArgs(args: string[]): GlobalConfig {
  const cliConfig: GlobalConfig = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--headless') {
      cliConfig.headless = true;
      continue;
    }

    const targetKey = VALUE_FLAGS[arg];
    if (!targetKey) {
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
  return {
    browserUrl: resolved.browserUrl,
    databaseUrl: resolved.databaseUrl,
    executablePath: resolved.executablePath,
    group: resolved.group,
    headless: resolved.headless,
    sekiroHost: resolved.sekiroHost,
    wsEndpoint: resolved.wsEndpoint,
  };
}
