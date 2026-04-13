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
import {getDaemonReachability, getDaemonPid} from '../../daemon/utils.js';

export const stopCommand: AxiCliCommand<DaemonContext> = async (
  _args,
  _ctx,
) => {
  const reachability = getDaemonReachability();

  if (reachability === 'orphaned') {
    const stalePid = getDaemonPid();
    throw new AxiError(
      `发现孤儿 daemon 进程 (PID:${stalePid})，socket 已丢失`,
      'DAEMON_ORPHANED',
      [`请手动 kill 该进程：kill ${stalePid}`],
    );
  }

  if (reachability === 'stopped') {
    throw new AxiError('停止失败：后台服务未运行', 'DAEMON_NOT_RUNNING', [
      '请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    ]);
  }

  // reachability === 'running'
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
