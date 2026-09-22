/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 会话与 daemon spawn flag 的 argv 解析。runAxiCli 要求 flag 必须位于命令之后
 * （`browsercli <command> [...] -s=x`），因此这里对全量 argv 扫描，
 * 而不是解析命令段之后的 args。
 */

import type {CliConfig} from './daemonClient.js';

/** spawn detached daemon 时允许透传给 worker 的 flag 白名单 */
export const DAEMON_SPAWN_FLAGS = [
  '--no-console',
  '--cloak',
  '--js-stealth',
  '--full-stealth-args',
  '--minimal-stealth',
  '--headless',
] as const;

/** 允许带值的 spawn flag */
export const DAEMON_VALUE_FLAGS = [
  '--console-port',
  '--browserUrl',
  '--wsEndpoint',
  '--executablePath',
] as const;

/**
 * 从 argv 解析会话名：-s=x / -s x / --session=x / --session x。
 * 不用 parseArgs —— 组合短选项分支会把 `-s=x` 拆成 s/=/x 三个布尔 flag。
 */
export function sessionFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = /^(?:-s|--session)=(.+)$/.exec(arg);
    if (eq) return eq[1];
    if (
      (arg === '-s' || arg === '--session') &&
      argv[i + 1] !== undefined &&
      !argv[i + 1].startsWith('-')
    ) {
      return argv[i + 1];
    }
  }
  return undefined;
}

/**
 * 提取命令之前的前置会话 flag（`browsercli -s=x open`）。
 * runAxiCli 会以 "Flags must come after the command" 拒绝以 `-` 开头的
 * argv[0]，故 bin 入口先把前置 -s/--session 摘出来再把 rest 交给 SDK。
 */
export function extractLeadingSession(argv: readonly string[]): {
  session?: string;
  rest: string[];
} {
  const rest = [...argv];
  let session: string | undefined;
  while (rest.length > 0) {
    const head = rest[0];
    if (head === '-s' || head === '--session') {
      const value = rest[1];
      if (value !== undefined && !value.startsWith('-')) {
        session = value;
        rest.splice(0, 2);
        continue;
      }
      break;
    }
    const eq = /^(-s|--session)=(.+)$/.exec(head);
    if (eq?.[2]) {
      session = eq[2];
      rest.shift();
      continue;
    }
    break;
  }
  return {session, rest};
}

/** 从 argv 提取可透传给 daemon spawn 的 flag 序列（仅白名单内，保持 `--flag=value` 形态） */
export function spawnFlagsFromArgv(argv: readonly string[]): string[] {
  const result: string[] = [];
  for (const arg of argv) {
    const name = arg.split('=')[0];
    if ((DAEMON_SPAWN_FLAGS as readonly string[]).includes(name)) {
      result.push(arg);
    } else if (
      (DAEMON_VALUE_FLAGS as readonly string[]).includes(name) &&
      arg.includes('=')
    ) {
      result.push(arg);
    }
  }
  return result;
}

/** 配置文件可下发的 spawn 相关键（值均为字符串，布尔以 'true'/'false' 存储） */
export type CliSpawnConfig = Pick<
  CliConfig,
  | 'headless'
  | 'cloak'
  | 'jsStealth'
  | 'fullStealthArgs'
  | 'minimalStealth'
  | 'browserUrl'
  | 'wsEndpoint'
  | 'executablePath'
>;

const CONFIG_BOOL_TO_FLAG: Record<string, string> = {
  headless: '--headless',
  cloak: '--cloak',
  jsStealth: '--js-stealth',
  fullStealthArgs: '--full-stealth-args',
  minimalStealth: '--minimal-stealth',
};

const CONFIG_VALUE_TO_FLAG: Record<string, string> = {
  browserUrl: '--browserUrl',
  wsEndpoint: '--wsEndpoint',
  executablePath: '--executablePath',
};

/**
 * 合并 spawnFlagsFromArgv(argv) 与配置文件下发的 flag。
 * argv 显式出现过的 flag 名以 argv 为准（不重复追加）。
 */
export function mergeSpawnFlagsFromConfig(
  argv: readonly string[],
  config: CliSpawnConfig,
): string[] {
  const merged = spawnFlagsFromArgv(argv);
  // 只抑制「确已被 spawnFlagsFromArgv 采纳」的 flag：空格形态的带值 flag
  // （`--browserUrl http://x`）不会被采纳，此时不应连配置文件的值一起丢。
  const argvFlagNames = new Set(merged.map(arg => arg.split('=')[0]));

  for (const [key, flag] of Object.entries(CONFIG_BOOL_TO_FLAG)) {
    if (
      config[key as keyof CliSpawnConfig] === 'true' &&
      !argvFlagNames.has(flag)
    ) {
      merged.push(flag);
    }
  }
  for (const [key, flag] of Object.entries(CONFIG_VALUE_TO_FLAG)) {
    const value = config[key as keyof CliSpawnConfig];
    if (value && !argvFlagNames.has(flag)) {
      merged.push(`${flag}=${value}`);
    }
  }
  return merged;
}
