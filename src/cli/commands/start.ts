/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {AxiError} from '../errors.js';
import {parseArgs, getFlag, getBoolFlag} from '../args-parser.js';
import {successOutput} from '../output.js';
import {startDaemon} from '../../daemon/client.js';
import {getDaemonReachability, getDaemonPid} from '../../daemon/utils.js';

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
  const waitForBrowser = getBoolFlag(parsed, 'wait-for-browser');

  const reachability = getDaemonReachability();

  if (reachability === 'running') {
    throw new AxiError('Daemon 已经在运行中', 'DAEMON_ALREADY_RUNNING', [
      '如需重启，请先执行：js-reverse stop',
    ]);
  }

  if (reachability === 'orphaned') {
    const stalePid = getDaemonPid();
    throw new AxiError(
      `发现孤儿 daemon 进程 (PID:${stalePid})，socket 已丢失`,
      'DAEMON_ORPHANED',
      [`请手动 kill 该进程：kill ${stalePid}`, '然后重新执行 js-reverse start'],
    );
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

  // Optionally wait for browser to become reachable
  if (waitForBrowser && browserUrl) {
    const maxAttempts = 60;
    const intervalMs = 500;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const resp = await fetch(`${browserUrl}/json/version`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          break;
        }
      } catch {
        // not ready yet
      }
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    if (attempts === maxAttempts) {
      throw new AxiError(
        `等待浏览器连接超时 (${maxAttempts * intervalMs / 1000}s)`,
        'BROWSER_TIMEOUT',
        [
          `确认 Chrome 已启动并监听：${browserUrl}`,
          '需要启动标志：--remote-debugging-port=9222',
          '示例：chrome --remote-debugging-port=9222',
        ],
      );
    }
  }

  const result: Record<string, unknown> = {
    command: 'start',
    message: 'Daemon 启动成功',
  };

  if (http) {
    result.httpMode = true;
    result.httpPort = port;
  }

  if (waitForBrowser && browserUrl) {
    result.browserUrl = browserUrl;
    result.waitedForBrowser = true;
  }

  return successOutput(result);
};
