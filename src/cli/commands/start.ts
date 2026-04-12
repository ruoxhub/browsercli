/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {parseArgs, getFlag, getBoolFlag} from '../args-parser.js';
import {successOutput} from '../output.js';
import {startDaemon} from '../../daemon/client.js';
import {isDaemonRunning} from '../../daemon/utils.js';

export const startCommand: AxiCliCommand<DaemonContext> = async (
  args,
  _ctx,
) => {
  const parsed = parseArgs(args);
  const browserUrl = getFlag(parsed, 'browserUrl');
  const wsEndpoint = getFlag(parsed, 'wsEndpoint');
  const headless = getBoolFlag(parsed, 'headless');
  const executablePath = getFlag(parsed, 'executablePath');
  const http = getBoolFlag(parsed, 'http');
  const port = getFlag(parsed, 'port', '3000');

  if (isDaemonRunning()) {
    return {
      status: 'error',
      message: 'Daemon 已经在运行中',
      suggestion: '如需重启，请先执行：js-reverse stop',
    };
  }

  const daemonArgs: string[] = [];

  if (browserUrl) {
    daemonArgs.push('--browserUrl', browserUrl);
  }
  if (wsEndpoint) {
    daemonArgs.push('--wsEndpoint', wsEndpoint);
  }
  if (headless) {
    daemonArgs.push('--headless');
  }
  if (executablePath) {
    daemonArgs.push('--executablePath', executablePath);
  }

  await startDaemon(daemonArgs);

  const result: Record<string, unknown> = {
    command: 'start',
    message: 'Daemon 启动成功',
  };

  if (http) {
    result.httpMode = true;
    result.httpPort = port;
  }

  return successOutput(result);
};
