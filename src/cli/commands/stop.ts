/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

export const stopCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const workerManager = ctx?.workerManager;

  if (!workerManager?.isRunning()) {
    throw new AxiError('停止失败：Worker 未运行', 'WORKER_NOT_RUNNING', [
      '请先执行：browsercli start --browserUrl <chrome-debug-url>',
    ]);
  }

  try {
    await workerManager.stop();
    return successOutput({
      command: 'stop',
      message: 'Worker 已停止',
    });
  } catch (error) {
    throw new AxiError(
      `停止失败：${error instanceof Error ? error.message : error}`,
      'WORKER_ERROR',
      ['确保 Worker 正在运行：browsercli status'],
    );
  }
};
