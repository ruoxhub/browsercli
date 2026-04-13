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
      message: '后台服务未运行。请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    };
  }

  // reachability === 'running'
  try {
    const result = await sendCommand({method: 'status'});
    if (result.success && result.result) {
      const info = JSON.parse(result.result as string);
      return successOutput({
        command: 'status',
        running: true,
        pid: info.pid,
        socketPath: info.socketPath,
        startDate: info.startDate,
        args: info.args,
      });
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
