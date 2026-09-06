/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 模式 argv 解析（纯函数）。与 proxycli/src/sessionArgs.ts 的
 * spawnFlagsFromArgv 白名单配对：CLI 侧透传的 flag 必须在这里被识别。
 * daemon 专属 token（--daemon/--proxycli-daemon/--session/--no-console/
 * --console-port）在此消费掉，其余参数进 plan.spawnFlags 交由
 * parseWorkerArgs 播种配置 —— 与非 daemon 模式的未知参数告警语义一致。
 */

export interface DaemonPlan {
  daemon: boolean;
  /** CLI spawn 时必带；手动起的 daemon 没有该标记（kill-all 靠它识别）。 */
  proxycliDaemon: boolean;
  session: string;
  noConsole: boolean;
  /** --minimal-stealth：daemonMain 播种到 browser 配置（GlobalConfig 顶层无此键） */
  minimalStealth: boolean;
  consolePort?: number;
  /** 去掉 daemon 专属 token 后的剩余参数，供 parseWorkerArgs 消费 */
  spawnFlags: string[];
}

function flagName(arg: string): string {
  return arg.split('=')[0];
}

export function buildDaemonArgPlan(argv: readonly string[]): DaemonPlan {
  let daemon = false;
  let proxycliDaemon = false;
  let noConsole = false;
  let minimalStealth = false;
  let session: string | undefined;
  let consolePort: number | undefined;
  const spawnFlags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--daemon') {
      daemon = true;
      continue;
    }
    if (arg === '--proxycli-daemon' || arg === '--proxycli-daemon') {
      proxycliDaemon = true;
      continue;
    }
    const name = flagName(arg);
    if (name === '--session') {
      session = arg.includes('=') ? arg.slice('--session='.length) : argv[++i];
      continue;
    }
    if (name === '--console-port') {
      const raw = arg.includes('=')
        ? arg.slice('--console-port='.length)
        : argv[++i];
      const port = Number.parseInt(raw ?? '', 10);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) {
        consolePort = port;
      }
      continue;
    }
    if (arg === '--no-console') {
      noConsole = true;
      continue;
    }
    if (arg === '--minimal-stealth') {
      minimalStealth = true;
      continue;
    }
    spawnFlags.push(arg);
  }

  return {
    daemon,
    proxycliDaemon,
    session:
      session ||
      process.env.PROXYCLI_SESSION ||
      process.env.PROXYCLI_SESSION ||
      'default',
    noConsole,
    minimalStealth,
    consolePort,
    spawnFlags,
  };
}
