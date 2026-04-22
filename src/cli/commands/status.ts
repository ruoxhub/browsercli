/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import type {DaemonContext} from '../types.js';
import {WorkerManager} from '../worker-manager.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import {resolveConfig} from '../config.js';

export const statusCommand: AxiCliCommand<DaemonContext> = async (
  _args,
  ctx,
) => {
  const workerManager = ctx?.workerManager ?? new WorkerManager();
  const isRunning = workerManager.isRunning();
  const pid = workerManager.getPid();

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
  const cfg = ctx?.resolvedConfig ?? resolveConfig();
  const invoker = ctx?.invoker ?? new SekiroInvoker({sekiroHost: cfg.sekiroHost});

  try {
    const clients = await invoker.listClients(cfg.group) as {clients?: unknown[]};
    onlineClients = clients.clients?.length ?? 0;
    sekiroConnected = onlineClients > 0;
  } catch {
    sekiroConnected = false;
  }

  const output: Record<string, unknown> = {
    command: 'status',
    running: true,
    pid,
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
