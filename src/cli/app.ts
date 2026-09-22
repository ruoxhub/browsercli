/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {browserCommand} from './commands/browser.js';
import {configCommand} from './commands/config.js';
import {jobsCommand} from './commands/jobs.js';
import {listToolsCommand} from './commands/list-tools.js';
import {scaffoldCommand} from './commands/scaffold.js';
import {sessionCommands} from './commands/sessions.js';
import {statusCommand} from './commands/status.js';
import {toolDispatcherCommand} from './commands/tool-dispatcher.js';
import {webCommand} from './commands/web.js';
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

export const cliCommands: Record<string, AxiCliCommand<WorkerContext>> = {
  call: toolDispatcherCommand,
  'list-tools': listToolsCommand,
  browser: browserCommand,
  jobs: jobsCommand,
  config: configCommand,
  scaffold: scaffoldCommand,
  status: statusCommand,
  web: webCommand,
  ...sessionCommands,
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
