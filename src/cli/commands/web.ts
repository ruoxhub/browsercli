/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

import {getBoolFlag, parseArgs} from '../args-parser.js';
import {ensureDaemon} from '../daemonClient.js';
import {openInBrowser} from '../open-browser.js';
import {successOutput} from '../output.js';
import {computeClientInfo, loadSession} from '../sessionPaths.js';
import type {WorkerContext} from '../types.js';

import {probeSession} from './sessions.js';

export interface WebCommandDeps {
  openBrowser?: (url: string) => boolean;
}

export function createWebCommand(
  deps: WebCommandDeps = {},
): AxiCliCommand<WorkerContext> {
  const openBrowser = deps.openBrowser ?? openInBrowser;

  return async (args, ctx) => {
    if (!ctx) throw new AxiError('内部错误：缺少会话上下文', 'INTERNAL');

    const parsed = parseArgs(args);
    const sub = parsed.positionals[0]?.toLowerCase();

    if (sub && sub !== 'status' && sub !== 'open' && sub !== 'start') {
      throw new AxiError(`未知子命令：${sub}`, 'VALIDATION_ERROR', [
        '用法：proxycli web [status] [--port=<port>] [--no-open] [--json]',
      ]);
    }

    const json = getBoolFlag(parsed, 'json');
    const noOpen = getBoolFlag(parsed, 'no-open');

    const portRaw =
      parsed.flags['port'] ?? parsed.flags['p'] ?? parsed.flags['console-port'];
    let customPort: number | undefined;
    if (portRaw !== undefined) {
      const portNum = Number(portRaw);
      if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65_535) {
        throw new AxiError(
          `无效的端口号：${String(portRaw)}`,
          'VALIDATION_ERROR',
          ['端口范围为 1-65535，如：proxycli web --port 8765'],
        );
      }
      customPort = portNum;
    }

    const info = computeClientInfo();
    const daemonDir = ctx.daemonDir ?? info.daemonDir;
    const host = process.env.WORKER_HOST ?? '127.0.0.1';

    let cfg = await loadSession(daemonDir, ctx.session);
    let isRunning = false;
    if (cfg) {
      const conn = await probeSession(cfg);
      if (conn) {
        conn.close();
        isRunning = true;
      }
    }

    if (sub === 'status') {
      const port =
        isRunning && cfg?.consolePort !== undefined ? cfg.consolePort : null;
      const online = port !== null;
      const url = port !== null ? `http://${host}:${port}` : null;
      const pid = isRunning && cfg ? cfg.pid : null;

      if (json) {
        return successOutput({
          command: 'web status',
          session: ctx.session,
          online,
          port,
          url,
          pid,
        });
      }

      if (!online) {
        return successOutput({
          command: 'web status',
          session: ctx.session,
          online: false,
          message: `会话 ${ctx.session} 的 Web 控制台未运行`,
        });
      }

      return successOutput({
        command: 'web status',
        session: ctx.session,
        online: true,
        port,
        url,
        pid,
        message: `Web 控制台运行中: ${url} (pid=${pid})`,
      });
    }

    // 启动或打开 Web 控制台
    if (!isRunning) {
      const spawnFlags = (ctx.spawnFlags ?? []).filter(
        f => f !== '--no-console' && !f.startsWith('--console-port='),
      );
      if (customPort !== undefined) {
        spawnFlags.push(`--console-port=${customPort}`);
      }
      cfg = await ensureDaemon({
        session: ctx.session,
        spawnFlags,
        daemonDir,
      });
    }

    if (!cfg || cfg.consolePort === undefined) {
      throw new AxiError(
        `会话 ${ctx.session} 的 Web 控制台未启用（可能以 --no-console 启动）`,
        'WEB_CONSOLE_DISABLED',
        [
          `先关闭该会话：proxycli -s=${ctx.session} close`,
          `再重新启动：proxycli -s=${ctx.session} web`,
        ],
      );
    }

    const url = `http://${host}:${cfg.consolePort}`;
    let opened = false;
    if (!noOpen) {
      opened = openBrowser(url);
    }

    let portNote = '';
    if (
      isRunning &&
      customPort !== undefined &&
      customPort !== cfg.consolePort
    ) {
      portNote = `（注意：会话已在运行，当前监听端口为 ${cfg.consolePort}，非指定的 ${customPort}）`;
    }

    const openSuffix = opened ? '（已在浏览器中打开）' : '';
    let message: string;
    if (isRunning) {
      message = `Web 控制台已在运行${portNote}: ${url}${openSuffix}`;
    } else {
      message = `Web 控制台已启动: ${url}${openSuffix}`;
    }

    if (json) {
      return successOutput({
        command: 'web',
        session: cfg.name,
        pid: cfg.pid,
        port: cfg.consolePort,
        url,
        opened,
        status: isRunning ? 'already-running' : 'started',
      });
    }

    return successOutput({
      command: 'web',
      session: cfg.name,
      pid: cfg.pid,
      port: cfg.consolePort,
      url,
      opened,
      message,
    });
  };
}

export const webCommand: AxiCliCommand<WorkerContext> = createWebCommand();
