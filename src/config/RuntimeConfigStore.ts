/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RuntimeConfigStore — 进程内存态配置单例。
 *
 * 启动时用 configFromEnv() + CLI 参数播种，不读任何 JSON 文件。
 * 面板通过 update() 修改配置，重启后回落到种子值。
 *
 * 深层字段（browser/openai/toolResultRecording）在 update()
 * 时做浅合并，避免面板只改一个字段却清空其余字段。
 */

import {configFromEnv} from './resolver.js';
import {type GlobalConfig, validateGlobalConfig} from './schema.js';

/** 需要浅合并的深层对象字段 */
const DEEP_MERGE_KEYS = new Set([
  'browser',
  'openai',
  'toolResultRecording',
]);

export class RuntimeConfigStore {
  private config: GlobalConfig;

  constructor(seed: GlobalConfig = configFromEnv()) {
    this.config = validateGlobalConfig(seed);
  }

  get(): Readonly<GlobalConfig> {
    return this.config;
  }

  update(partial: Partial<GlobalConfig>): GlobalConfig {
    const merged: GlobalConfig = {...this.config};

    for (const [key, value] of Object.entries(partial)) {
      if (
        value !== undefined &&
        DEEP_MERGE_KEYS.has(key) &&
        typeof value === 'object' &&
        value !== null
      ) {
        const oldValue = (this.config as Record<string, unknown>)[key];
        (merged as Record<string, unknown>)[key] =
          oldValue && typeof oldValue === 'object'
            ? {...(oldValue as object), ...(value as object)}
            : value;
      } else if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }

    this.config = validateGlobalConfig(merged);
    return this.config;
  }

  reset(seed?: GlobalConfig): void {
    this.config = validateGlobalConfig(seed ?? configFromEnv());
  }
}

let store: RuntimeConfigStore | undefined;

export function getRuntimeConfigStore(): RuntimeConfigStore {
  if (!store) {
    store = new RuntimeConfigStore();
  }
  return store;
}

/**
 * 重置 store（测试用）。传入 seed 则用 seed 重建；不传则从当前 env 重新播种。
 */
export function resetRuntimeConfigStore(seed?: GlobalConfig): void {
  store = new RuntimeConfigStore(seed);
}
