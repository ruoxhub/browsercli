/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {resolveConfig} from '../config.js';

import {configCommand} from './commands/config.js';
import {listToolsCommand} from './commands/list-tools.js';
import {replCommand} from './commands/repl.js';
import {scaffoldCommand} from './commands/scaffold.js';
import {startCommand} from './commands/start.js';
import {statusCommand} from './commands/status.js';
import {stopCommand} from './commands/stop.js';
import {toolDispatcherCommand} from './commands/tool-dispatcher.js';
import {generateTopLevelHelp} from './help.js';
import {SekiroInvoker} from './sekiro-invoker.js';
import type {WorkerContext} from './types.js';
import {WorkerManager} from './worker-manager.js';

export const cliDescription = 'JS逆向工程MCP服务 — 标准化前端JavaScript逆向流程';
export const cliVersion = '2.0.3';

export const cliCommands: Record<string, AxiCliCommand<WorkerContext>> = {
  call: toolDispatcherCommand,
  config: configCommand,
  'list-tools': listToolsCommand,
  repl: replCommand,
  scaffold: scaffoldCommand,
  start: startCommand,
  status: statusCommand,
  stop: stopCommand,
};

export const homeCommand: AxiCliCommand<WorkerContext> = async () =>
  generateTopLevelHelp();

export function createWorkerContext(): WorkerContext {
  const resolvedConfig = resolveConfig();
  const invoker = new SekiroInvoker({rpcHost: resolvedConfig.rpcHost});
  const workerManager = new WorkerManager();

  return {
    rpcHost: resolvedConfig.rpcHost,
    group: resolvedConfig.group,
    invoker,
    workerManager,
    resolvedConfig,
    config: {
      browserUrl: resolvedConfig.browserUrl,
      wsEndpoint: resolvedConfig.wsEndpoint,
      headless: resolvedConfig.headless,
      executablePath: resolvedConfig.executablePath,
    },
  };
}
