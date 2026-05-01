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
  const workerManager = ctx?.workerManager;
  const isRunning = workerManager?.isRunning() ?? false;
  const pid = workerManager?.getPid() ?? null;

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
  let rpcConnected = false;
  let onlineClients = 0;
  const cfg = ctx?.resolvedConfig;
  const invoker = ctx?.invoker;

  if (cfg && invoker) {
    try {
      const clients = await invoker.listClients(cfg.group) as {data?: unknown[]; clients?: unknown[]};
      // Sekiro clientQueue 返回格式: {data: [...], status: 0}
      const clientList = clients.data ?? clients.clients;
      onlineClients = Array.isArray(clientList) ? clientList.length : 0;
      rpcConnected = onlineClients > 0;
    } catch {
      rpcConnected = false;
    }
  }

  const output: Record<string, unknown> = {
    command: 'status',
    running: true,
    pid,
    rpcConnected,
    onlineClients,
  };

  if (!rpcConnected) {
    output.warnings = [
      'Worker 运行中但未连接到 Sekiro Server',
      '工具调用将会失败，请检查 rpc-go Server 状态',
    ];
    output.status = 'warn';
  }

  return output;
};
