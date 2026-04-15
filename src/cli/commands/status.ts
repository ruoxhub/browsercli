/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {successOutput} from '../output.js';
import {sendCommand} from '../../daemon/client.js';
import {getDaemonReachability, getDaemonPid} from '../../daemon/utils.js';

export const statusCommand: AxiCliCommand<DaemonContext> = async (
  _args,
  _ctx,
) => {
  const reachability = getDaemonReachability();

  if (reachability === 'orphaned') {
    return {
      status: 'warn',
      command: 'status',
      running: false,
      message:
        'Daemon 进程存在但 socket 已丢失，可能需要手动 kill PID:' +
        getDaemonPid(),
    };
  }

  if (reachability === 'stopped') {
    return {
      status: 'info',
      command: 'status',
      running: false,
      message:
        '后台服务未运行。请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    };
  }

  // reachability === 'running'
  let browserConnected = false;
  let browserUrl: string | undefined;
  let wsEndpoint: string | undefined;

  try {
    const result = await sendCommand({method: 'status'});
    if (result.success && result.result) {
      const info = JSON.parse(result.result as string);

      // Extract browser connection params from daemon args
      const args: string[] = info.args || [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--browserUrl') browserUrl = args[++i];
        else if (args[i] === '--wsEndpoint') wsEndpoint = args[++i];
      }

      // Actively check browser connectivity via Chrome DevTools endpoint
      if (browserUrl) {
        try {
          const response = await fetch(`${browserUrl}/json/version`, {
            signal: AbortSignal.timeout(3000),
          });
          browserConnected = response.ok;
        } catch {
          browserConnected = false;
        }
      } else {
        browserConnected = !!wsEndpoint;
      }

      const output: Record<string, unknown> = {
        command: 'status',
        running: true,
        pid: info.pid,
        socketPath: info.socketPath,
        startDate: info.startDate,
        browserConnected,
      };

      if (!browserConnected && (browserUrl || wsEndpoint)) {
        output.warnings = [
          'Browser 连接失败，请确认 Chrome 已启动并启用 --remote-debugging-port=9222',
          '工具调用将会失败，请先确保浏览器可达',
        ];
        output.status = 'warn';
      }

      return output;
    }
  } catch {
    // sendCommand 失败但 reachability 是 running，说明 socket 存在但连接异常
  }

  return {
    status: 'error',
    command: 'status',
    running: false,
    message: 'Daemon socket 存在但无法连接，请尝试重启',
  };
};
