/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {successOutput} from '../output.js';
import {sendCommand} from '../../daemon/client.js';

export const stopCommand: AxiCliCommand<DaemonContext> = async (
  _args,
  _ctx,
) => {
  try {
    const result = await sendCommand({method: 'stop'});
    if (result.success) {
      return successOutput({
        command: 'stop',
        message: 'Daemon 已停止',
      });
    }
    return {
      status: 'error',
      command: 'stop',
      message: `停止失败：${result.error}`,
    };
  } catch (error) {
    return {
      status: 'error',
      command: 'stop',
      message: `停止失败：${error instanceof Error ? error.message : error}`,
    };
  }
};
