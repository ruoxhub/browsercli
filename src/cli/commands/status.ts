/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {successOutput} from '../output.js';
import {sendCommand} from '../../daemon/client.js';

export const statusCommand: AxiCliCommand<DaemonContext> = async (
  _args,
  _ctx,
) => {
  try {
    const result = await sendCommand({method: 'status'});
    if (result.success) {
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
    return {
      status: 'info',
      command: 'status',
      running: false,
      message: 'Daemon 未运行',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('未运行')) {
      return {
        status: 'info',
        command: 'status',
        running: false,
        message,
      };
    }
    return {
      status: 'error',
      command: 'status',
      message: `获取状态失败：${message}`,
    };
  }
};
