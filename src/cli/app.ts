/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {configCommand} from './commands/config.js';
import {jobsCommand} from './commands/jobs.js';
import {listToolsCommand} from './commands/list-tools.js';
import {scaffoldCommand} from './commands/scaffold.js';
import {startCommand} from './commands/start.js';
import {statusCommand} from './commands/status.js';
import {stopCommand} from './commands/stop.js';
import {toolDispatcherCommand} from './commands/tool-dispatcher.js';
import {videoCommand} from './commands/video.js';
import {
  CLI_VERSION,
  DaemonConnection,
  ensureDaemon,
  loadCliConfig,
  verifyDaemonVersion,
} from './daemonClient.js';
import {generateTopLevelHelp} from './help.js';
import {mergeSpawnFlagsFromConfig, sessionFromArgv} from './sessionArgs.js';
import {resolveSessionName} from './sessionPaths.js';
import type {WorkerContext} from './types.js';

export const cliDescription = '逆向工程CLI服务';
export const cliVersion = CLI_VERSION;

const DEPRECATED_COMMAND_MIGRATIONS: Record<
  string,
  {replacement: string; hint: string}
> = {
  open: {
    replacement: 'browsercli start',
    hint: "命令 'open' 已废弃，现已统一对齐使用 'browsercli start'。若需传递浏览器参数可直接追加，如 'browsercli start --channel chrome'。",
  },
  close: {
    replacement: 'browsercli stop',
    hint: "命令 'close' 已废弃，现已统一对齐使用 'browsercli stop'。",
  },
  list: {
    replacement: 'browsercli status',
    hint: "命令 'list' 已废弃，会话列表与运行状态已统一整合进 'browsercli status'。",
  },
  'kill-all': {
    replacement: 'browsercli stop --all',
    hint: "命令 'kill-all' 已废弃，强杀所有会话已统一对齐使用 'browsercli stop --all'。",
  },
  browser: {
    replacement: 'browsercli start',
    hint: "命令 'browser' 已废弃。启动与连接浏览器已统一至 'browsercli start [options]'，查看状态请使用 'browsercli status'，关闭会话请使用 'browsercli stop'。",
  },
};

function createDeprecatedCommandHandler(
  cmd: string,
): AxiCliCommand<WorkerContext> {
  return async () => {
    const meta = DEPRECATED_COMMAND_MIGRATIONS[cmd];
    throw new AxiError(
      meta ? meta.hint : `命令 '${cmd}' 已废弃。`,
      'COMMAND_DEPRECATED',
      meta ? [`请使用替代命令: ${meta.replacement}`] : undefined,
    );
  };
}

export const cliCommands: Record<string, AxiCliCommand<WorkerContext>> = {
  start: startCommand,
  stop: stopCommand,
  status: statusCommand,
  video: videoCommand,
  call: toolDispatcherCommand,
  'list-tools': listToolsCommand,
  jobs: jobsCommand,
  config: configCommand,
  scaffold: scaffoldCommand,
  // 废弃旧命令兼容拦截
  open: createDeprecatedCommandHandler('open'),
  close: createDeprecatedCommandHandler('close'),
  list: createDeprecatedCommandHandler('list'),
  'kill-all': createDeprecatedCommandHandler('kill-all'),
  browser: createDeprecatedCommandHandler('browser'),
};

export const homeCommand: AxiCliCommand<WorkerContext> = async () =>
  generateTopLevelHelp();

export function createWorkerContext(argv: readonly string[]): WorkerContext {
  const session = resolveSessionName(sessionFromArgv(argv));
  const spawnFlags = mergeSpawnFlagsFromConfig(argv, loadCliConfig());
  return {
    session,
    spawnFlags,
    connect: async () => {
      let cfg;
      try {
        cfg = await ensureDaemon({session, spawnFlags});
      } catch (error) {
        throw new AxiError(
          `Worker 未运行：${error instanceof Error ? error.message : error}`,
          'WORKER_NOT_RUNNING',
        );
      }
      const conn = await DaemonConnection.connect(cfg.socketPath, 3000);
      void verifyDaemonVersion(session, cliVersion)
        .then(warn => {
          if (warn) console.warn(warn);
        })
        .catch(() => undefined);
      return conn;
    },
  };
}
