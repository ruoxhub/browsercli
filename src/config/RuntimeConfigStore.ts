/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RuntimeConfigStore — 进程内存态配置单例。
 *
 * 启动时默认用 loadUserConfig() (~/.browsercli/config.json) + CLI 参数播种。
 * 面板通过 update() 修改配置，重启后回落到种子值。
 *
 * 深层字段（browser/toolResultRecording）在 update()
 * 时做浅合并，避免面板只改一个字段却清空其余字段。
 */

/* eslint-disable import/no-cycle -- 已知例外：loadUserConfig() 播种 store 与 getRuntimeConfigStore() 读回 store 的初始化时序契约。见 spec §2.1 目标 2 与 §5.1 环 1 决议 A，Phase 4 复核。 */
import {loadUserConfig} from './resolver.js';
import {type GlobalConfig, validateGlobalConfig} from './schema.js';

/** 需要浅合并的深层对象字段 */
const DEEP_MERGE_KEYS = new Set(['browser', 'toolResultRecording']);

export class RuntimeConfigStore {
  private config: GlobalConfig;

  constructor(seed: GlobalConfig = loadUserConfig()) {
    this.config = validateGlobalConfig(seed);
  }

  get(): Readonly<GlobalConfig> {
    return this.config;
  }

  /**
   * 算出 `update(partial)` 会得到的那份配置，但**不提交**。
   *
   * 给「先校验、后写入」的调用方用：`update()` 的深合并会让上一次请求留下的
   * 字段活到这一次，所以校验必须针对合并后的结果，而校验一旦抛就不能让 store
   * 脏掉。
   */
  preview(partial: Partial<GlobalConfig>): GlobalConfig {
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

    return validateGlobalConfig(merged);
  }

  update(partial: Partial<GlobalConfig>): GlobalConfig {
    this.config = this.preview(partial);
    return this.config;
  }

  reset(seed?: GlobalConfig): void {
    this.config = validateGlobalConfig(seed ?? loadUserConfig());
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
 * 重置 store（测试用）。传入 seed 则用 seed 重建；不传则从 ~/.browsercli/config.json 重新播种。
 */
export function resetRuntimeConfigStore(seed?: GlobalConfig): void {
  store = new RuntimeConfigStore(seed);
}
