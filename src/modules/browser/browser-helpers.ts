/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {HARMFUL_ARGS, DEFAULT_ARGS, MINIMAL_STEALTH_ARGS, FULL_STEALTH_ARGS} from './stealth-args.js';

export type Engine = 'chromium' | 'firefox';

/**
 * 根据 channel 解析浏览器引擎类型
 */
export function resolveEngine(channel?: string): Engine {
  if (channel === 'firefox' || channel?.startsWith('moz-')) {
    return 'firefox';
  }
  return 'chromium';
}

/**
 * 解析 profile 目录名称
 *
 * cloak 模式强制落到 `cloak-profile`，无论 channel 是什么； cloak 与默认
 * 模式使用不同 Chromium 二进制（前者 patch 了 49 个 C++ 指纹点，后者是系统
 * Chrome），混用 profile 会同时污染两边的 state（shader cache、service
 * worker、扩展注册表），导致启动 race 和会话崩溃。
 */
export function resolveProfileDirName(
  channel?: string,
  cloak?: boolean,
): string {
  if (cloak) return 'cloak-profile';
  const engine = resolveEngine(channel);
  const profileBase =
    engine === 'firefox' ? 'firefox-profile' : 'chrome-profile';
  return channel && channel !== 'stable'
    ? `${profileBase}-${channel}`
    : profileBase;
}

/**
 * 解析用户数据目录路径
 */
export function resolveUserDataDir(
  isolated: boolean,
  userDataDir: string | undefined,
  channel?: string,
  cloak?: boolean,
): string | undefined {
  if (isolated || userDataDir) {
    return userDataDir;
  }
  return path.join(
    os.homedir(),
    '.cache',
    'chrome-devtools-mcp',
    resolveProfileDirName(channel, cloak),
  );
}

/**
 * 确保用户数据目录存在
 */
export async function ensureUserDataDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, {recursive: true});
}

/**
 * 解析 patchright 启动时使用的 channel 参数
 *
 * - bidi-/moz- 前缀：直接传递给 patchright
 * - Firefox 无显式 channel：让 patchright 选择默认 firefox 构建
 * - Chromium CDP：仅在没有显式可执行文件时注入 Playwright channel 名称
 */
export function resolveLaunchChannel(
  channel: string | undefined,
  engine: Engine,
  hasExecutablePath: boolean,
): string | undefined {
  // Pass-through routes for patchright's prefix-based dispatch
  if (channel?.startsWith('bidi-')) return channel;
  if (channel?.startsWith('moz-')) return channel;

  // Firefox without explicit channel: let patchright pick the default firefox build
  if (engine === 'firefox') return undefined;

  // Chromium CDP: only inject a Playwright channel name when no explicit executable
  if (hasExecutablePath) return undefined;
  if (!channel || channel === 'stable') return 'chrome';
  return `chrome-${channel}`;
}

/**
 * 获取 Chromium 启动时应该忽略的默认参数
 */
export function getIgnoreDefaultArgs(engine: Engine): string[] | undefined {
  return engine === 'chromium' ? HARMFUL_ARGS : undefined;
}

/**
 * 构建浏览器启动参数
 *
 * @param baseArgs - 用户提供的额外参数
 * @param engine - 浏览器引擎类型
 * @param options - 启动选项
 */
export function buildLaunchArgs(
  baseArgs: string[] | undefined,
  engine: Engine,
  options: {
    headless?: boolean;
    devtools?: boolean;
    useStealthScripts?: boolean;
    includeDefaults?: boolean;
    minimalStealth?: boolean;
    fullStealthArgs?: boolean;
  } = {},
): string[] {
  const args = [...(baseArgs ?? [])];

  if (engine !== 'chromium') {
    return args;
  }

  // Chromium-specific args
  if (options.includeDefaults) {
    args.unshift(...DEFAULT_ARGS);
  }

  // Stealth args：默认不注入（历史行为）。新代码路径（顶层 launch() 与
  // BrowserManager 的默认启动路径）通过 `minimalStealth: true` 显式拿
  // 最小集；`fullStealthArgs: true` 或遗留 `useStealthScripts: true`
  // 显式拿完整 60+ 集（`--full-stealth-args` 回退开关）。
  if (options.fullStealthArgs || options.useStealthScripts) {
    args.push(...FULL_STEALTH_ARGS);
  } else if (options.minimalStealth) {
    args.push(...MINIMAL_STEALTH_ARGS);
  }

  if (options.headless) {
    args.push('--screen-info={3840x2160}');
  }
  if (options.devtools) {
    args.push('--auto-open-devtools-for-tabs');
  }

  return args;
}
