/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {WorkerContext} from '../types.js';

export const statusCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const workerState = ctx?.workerState;
  const isRunning = workerState?.running ?? false;

  if (!isRunning) {
    return {
      status: 'info',
      command: 'status',
      running: false,
      message:
        'Worker 未运行。请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    };
  }

  // 检查 Sekiro Server 连接状态
  let sekiroConnected = false;
  let onlineClients = 0;
  const cfg = ctx?.resolvedConfig;
  const invoker = ctx?.invoker;

  if (cfg && invoker) {
    try {
      const clients = await invoker.listClients(cfg.group) as {clients?: unknown[]};
      onlineClients = clients.clients?.length ?? 0;
      sekiroConnected = onlineClients > 0;
    } catch {
      sekiroConnected = false;
    }
  }

  const output: Record<string, unknown> = {
    command: 'status',
    running: true,
    sekiroConnected,
    onlineClients,
  };

  if (!sekiroConnected) {
    output.warnings = [
      'Worker 运行中但未连接到 Sekiro Server',
      '工具调用将会失败，请检查 sekiro-go Server 状态',
    ];
    output.status = 'warn';
  }

  return output;
};
