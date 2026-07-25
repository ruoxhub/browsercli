/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {configCommand} from './commands/config.js';
import {listToolsCommand} from './commands/list-tools.js';
import {scaffoldCommand} from './commands/scaffold.js';
import {statusCommand} from './commands/status.js';
import {toolDispatcherCommand} from './commands/tool-dispatcher.js';
import {generateTopLevelHelp} from './help.js';
import type {WorkerContext} from './types.js';
import {WorkerHttpClient} from './WorkerHttpClient.js';

export const cliDescription = '逆向工程CLI服务';
export const cliVersion = '1.0.0';

export const cliCommands: Record<string, AxiCliCommand<WorkerContext>> = {
  call: toolDispatcherCommand,
  config: configCommand,
  'list-tools': listToolsCommand,
  scaffold: scaffoldCommand,
  status: statusCommand,
};

export const homeCommand: AxiCliCommand<WorkerContext> = async () =>
  generateTopLevelHelp();

export function createWorkerContext(): WorkerContext {
  const transport = (process.env.WORKER_TRANSPORT ?? 'http') as
    | 'http'
    | 'sekiro';
  const httpClient = new WorkerHttpClient({
    baseUrl: process.env.WORKER_URL ?? 'http://127.0.0.1:8765',
    apiToken: process.env.WORKER_API_TOKEN,
  });

  return {
    httpClient,
    transport,
  };
}
