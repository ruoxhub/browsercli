/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {AxiError} from '../errors.js';
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
    throw new AxiError(`停止失败：${result.error}`, 'DAEMON_ERROR', [
      '检查 daemon 是否正在运行：js-reverse status',
    ]);
  } catch (error) {
    if (error instanceof AxiError) throw error;
    throw new AxiError(
      `停止失败：${error instanceof Error ? error.message : error}`,
      'DAEMON_ERROR',
      ['确保后台服务正在运行：js-reverse start --browserUrl <url>'],
    );
  }
};
