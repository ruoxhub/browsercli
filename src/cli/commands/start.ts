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

const BROWSER_POLL_ATTEMPTS = 60;
const BROWSER_POLL_INTERVAL_MS = 500;
const BROWSER_FETCH_TIMEOUT_MS = 3000;

async function waitForBrowserReachable(browserUrl: string): Promise<void> {
  for (let attempt = 1; attempt <= BROWSER_POLL_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${browserUrl}/json/version`, {
        signal: AbortSignal.timeout(BROWSER_FETCH_TIMEOUT_MS),
      });
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    if (attempt < BROWSER_POLL_ATTEMPTS) {
      await new Promise(resolve =>
        setTimeout(resolve, BROWSER_POLL_INTERVAL_MS),
      );
    }
  }
  throw new AxiError(
    `等待浏览器连接超时 (${(BROWSER_POLL_ATTEMPTS * BROWSER_POLL_INTERVAL_MS) / 1000}s)`,
    'BROWSER_TIMEOUT',
    [
      `确认 Chrome 已启动并监听：${browserUrl}`,
      '需要启动标志：--remote-debugging-port=9222',
      '示例：chrome --remote-debugging-port=9222',
    ],
  );
}

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
  if (browserUrl) daemonArgs.push('--browserUrl', browserUrl);
  if (wsEndpoint) daemonArgs.push('--wsEndpoint', wsEndpoint);
  if (headless) daemonArgs.push('--headless');
  if (executablePath) daemonArgs.push('--executablePath', executablePath);

  await startDaemon(daemonArgs);

  if (waitForBrowser && browserUrl) {
    await waitForBrowserReachable(browserUrl);
  }

  return successOutput({
    command: 'start',
    message: 'Daemon 启动成功',
    ...(http && {httpMode: true, httpPort: port}),
    ...(waitForBrowser && browserUrl && {browserUrl, waitedForBrowser: true}),
  });
};
