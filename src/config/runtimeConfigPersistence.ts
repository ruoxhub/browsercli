/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RuntimeConfigStore 持久化 — 把面板改动落盘到 ~/.browsercli/runtime-config.json，
 * 下次启动时回填，避免重复配置连接参数。
 *
 * 只持久化「连接设置」相关的可写字段：browser。
 * 启动期固定值由 CLI/环境变量决定，不在此缓存。
 *
 * 注意：browser.wsEndpoint / browserURL 等连接目标会明文写入该文件。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import {dirname, join} from 'node:path';

import {type GlobalConfig, validateGlobalConfig} from './schema.js';

export const RUNTIME_CONFIG_PATH = join(
  os.homedir(),
  '.browsercli',
  'runtime-config.json',
);

/** 需要持久化的顶层字段 */
export const PERSISTED_KEYS: ReadonlySet<keyof GlobalConfig> = new Set<
  keyof GlobalConfig
>(['browser']);

/** 从缓存文件提取可写字段，未命中或非法时返回 undefined。 */
export function loadCachedRuntimeConfig(): Partial<GlobalConfig> | undefined {
  if (!existsSync(RUNTIME_CONFIG_PATH)) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(
      readFileSync(RUNTIME_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''),
    );
  } catch {
    return undefined;
  }

  try {
    const validated = validateGlobalConfig({...(raw as object)});
    const persisted: Partial<GlobalConfig> = {};
    for (const key of PERSISTED_KEYS) {
      if (validated[key] !== undefined) {
        (persisted as Record<string, unknown>)[key] = validated[key];
      }
    }
    return Object.keys(persisted).length > 0 ? persisted : undefined;
  } catch {
    return undefined;
  }
}

/** 把当前配置的可写字段落盘（失败静默，仅记录到 console）。 */
export function persistRuntimeConfig(config: GlobalConfig): void {
  const persisted: Partial<GlobalConfig> = {};
  for (const key of PERSISTED_KEYS) {
    const value = config[key];
    if (value !== undefined) {
      (persisted as Record<string, unknown>)[key] = value;
    }
  }

  try {
    mkdirSync(dirname(RUNTIME_CONFIG_PATH), {recursive: true});
    writeFileSync(
      RUNTIME_CONFIG_PATH,
      JSON.stringify(persisted, null, 2),
      'utf8',
    );
  } catch (err) {
    console.error('[runtime-config] 保存缓存失败:', err);
  }
}

/**
 * 判断启动时是否应自动连接浏览器。
 * 仅当缓存里有「连接目标」信息（wsEndpoint / browserURL）才自动连接——
 * 纯 launch 模式的本地浏览器无需（也不应）在启动时抢占。
 */
export function shouldAutoConnectOnStartup(config: GlobalConfig): boolean {
  const browser = config.browser;
  return Boolean(browser?.wsEndpoint || browser?.browserURL);
}

/**
 * 删除缓存文件（供「重置配置」使用）。
 * 返回是否真的删干净：ENOENT 本来就没有缓存，算成功；其余错误（Windows 上
 * 文件被其它进程抱着时 EPERM/EBUSY 很常见）记录到 console 并返回 false，
 * 让调用方（Task 3 的 reset 路由）能区分“已重置”和“没删掉”。
 * 之前返回 void 吐掉所有错误 → reset 永远回 200，旧缓存仍在盘上，
 * 下次进程启动又把用户刚删的配置回填。
 */
export function deleteRuntimeConfig(): boolean {
  try {
    unlinkSync(RUNTIME_CONFIG_PATH);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    console.error('[runtime-config] 删除缓存失败:', err);
    return false;
  }
}
