/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {parseArgs} from '../args-parser.js';
import {DaemonConnection, ensureDaemon, stopSession} from '../daemonClient.js';
import {toAxiError} from '../errors.js';
import {successOutput} from '../output.js';
import {computeClientInfo, loadSession} from '../sessionPaths.js';
import type {
  BrowserConnectOptions,
  BrowserConnectionStatus,
  WorkerContext,
} from '../types.js';

import {BROWSER_LAUNCH_OR_CONNECT_FLAGS, connectOptions} from './browser.js';
import {probeSession} from './sessions.js';

export const startCommand: AxiCliCommand<WorkerContext> = async (args, ctx) => {
  if (!ctx) throw new AxiError('内部错误：缺少会话上下文', 'INTERNAL');
  const parsed = parseArgs(args);
  const info = computeClientInfo();
  const daemonDir = ctx.daemonDir ?? info.daemonDir;

  const existing = await loadSession(daemonDir, ctx.session);
  let restarted = false;
  if (existing) {
    const conn = await probeSession(existing);
    if (conn) {
      conn.close();
      // 存在运行中会话，按 chrome-devtools 语义执行 restart
      restarted = true;
      await stopSession(existing, daemonDir);
    }
  }

  // 拉起新 daemon
  const cfg = await ensureDaemon({
    session: ctx.session,
    spawnFlags: ctx.spawnFlags ?? [],
    daemonDir,
  });

  // 仅当命令行显式传入了浏览器连接相关 flag 时，才在 start 后主动发起 browser.connect IPC
  const explicitBrowserFlags = Object.keys(parsed.flags).some(k =>
    BROWSER_LAUNCH_OR_CONNECT_FLAGS.has(k),
  );
  let browserStatus: BrowserConnectionStatus | undefined;

  if (explicitBrowserFlags) {
    const browserOpts: BrowserConnectOptions | undefined = connectOptions(
      parsed.flags,
    );
    if (browserOpts && Object.keys(browserOpts).length > 0) {
      let client: DaemonConnection | undefined;
      try {
        client = await DaemonConnection.connect(cfg.socketPath, 3000);
        const startTime = Date.now();
        const retryTimeoutMs = 35_000;
        for (;;) {
          try {
            browserStatus = await client.request<BrowserConnectionStatus>(
              'browser.connect',
              {body: browserOpts},
            );
            break;
          } catch (err) {
            if (
              err instanceof Error &&
              /WORKER_BUSY/.test(err.message) &&
              /browser connect/.test(err.message)
            ) {
              if (Date.now() - startTime < retryTimeoutMs) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
              }
              throw new Error(
                '[WORKER_BUSY] Worker 正在连接浏览器中（可能正在等待 Chrome 弹窗授权或网络连接响应）。\n' +
                  '请留意 Chrome 界面顶部的 "Allow remote debugging" 弹窗，或稍后运行 "browsercli status" 查看连接结果。',
              );
            }
            throw err;
          }
        }
      } catch (error) {
        throw toAxiError(error, 'BROWSER_ERROR');
      } finally {
        client?.close();
      }
    }
  }

  return successOutput({
    command: 'start',
    action: restarted ? 'restart' : 'start',
    session: cfg.name,
    pid: cfg.pid,
    consolePort: cfg.consolePort ?? null,
    socketPath: cfg.socketPath,
    ...(browserStatus ? {browser: browserStatus} : {}),
  });
};
