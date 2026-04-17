/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {AxiError} from '../errors.js';
import {successOutput} from '../output.js';
import {sendCommand} from '../../daemon/client.js';
import {
  getDaemonReachability,
  getDaemonPid,
  getPidFilePath,
} from '../../daemon/utils.js';

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

    // Handle IPC errors (daemon socket exists but daemon is unresponsive).
    // Clean up the PID file so that getDaemonReachability() returns 'stopped'
    // on the next call, making 'stop' idempotent regardless of daemon state.
    const errMsg = error instanceof Error ? error.message : String(error);
    if (isIpcError(errMsg)) {
      cleanupPidFile();
      throw new AxiError(
        '停止失败：daemon 响应超时，已清理残留状态',
        'DAEMON_NOT_RUNNING',
        ['请先执行：js-reverse start --browserUrl <chrome-debug-url>'],
      );
    }
    throw new AxiError(`停止失败：${errMsg}`, 'DAEMON_ERROR', [
      '确保后台服务正在运行：js-reverse start --browserUrl <url>',
    ]);
  }
};

const IPC_ERROR_PATTERNS = [
  'IPC 请求超时',
  'ETIMEDOUT',
  'ECONNREFUSED',
] as const;

function isIpcError(message: string): boolean {
  return IPC_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

function cleanupPidFile(): void {
  try {
    fs.unlinkSync(getPidFilePath());
  } catch {
    // ignore
  }
}
