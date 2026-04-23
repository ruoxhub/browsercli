/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {WorkerContext} from '../types.js';
import {AxiError} from 'axi-sdk-js';
import {successOutput} from '../output.js';
import {stopWorker} from '../../index.js';

export const stopCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const workerState = ctx?.workerState;

  if (!workerState?.running) {
    throw new AxiError('停止失败：Worker 未运行', 'WORKER_NOT_RUNNING', [
      '请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    ]);
  }

  try {
    await stopWorker();
    return successOutput({
      command: 'stop',
      message: 'Worker 已停止',
    });
  } catch (error) {
    throw new AxiError(
      `停止失败：${error instanceof Error ? error.message : error}`,
      'WORKER_ERROR',
      ['确保 Worker 正在运行：js-reverse status'],
    );
  }
};
