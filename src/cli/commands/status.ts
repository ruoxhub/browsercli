/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import type {WorkerContext} from '../types.js';

/** Worker 端 _status 返回的详细健康数据 */
interface WorkerHealthData {
  pid: number;
  status: {
    isInitialized: boolean;
    isConnected: boolean;
    connectionState: string;
    group: string;
    clientId: string;
    actionCount: number;
    rpcHost: string;
  };
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  nodeVersion: string;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ${Math.floor(seconds % 60)}s`;
}

function healthEmoji(status: string): string {
  switch (status) {
    case 'healthy': return '●';
    case 'degraded': return '◐';
    case 'unhealthy': return '○';
    default: return '?';
  }
}

export const statusCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const workerManager = ctx?.workerManager;
  const isRunning = workerManager?.isRunning() ?? false;
  const pid = workerManager?.getPid() ?? null;
  const guardianSnapshot = workerManager?.getGuardianSnapshot();

  if (!isRunning) {
    return {
      status: 'info',
      command: 'status',
      running: false,
      message:
        'Worker 未运行。请先执行：js-reverse start --browserUrl <chrome-debug-url>',
    };
  }

  const cfg = ctx?.resolvedConfig;
  const invoker = ctx?.invoker;

  // 默认值
  let workerHealth: WorkerHealthData | null = null;
  let rpcConnected = false;
  let onlineClients = 0;
  let workerQueryError: string | null = null;

  if (cfg && invoker) {
    // 1. 查询 Sekiro 在线客户端数
    try {
      const clients = await invoker.listClients(cfg.group) as {
        data?: unknown[];
        clients?: unknown[];
      };
      const clientList = clients.data ?? clients.clients;
      onlineClients = Array.isArray(clientList) ? clientList.length : 0;
      rpcConnected = onlineClients > 0;
    } catch {
      rpcConnected = false;
    }

    // 2. 通过 Sekiro 调用 worker _status action 获取详细健康数据
    if (rpcConnected) {
      try {
        workerHealth = await invoker.invoke(cfg.group, '_status') as WorkerHealthData;
      } catch (err) {
        workerQueryError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // 构建输出
  const output: Record<string, unknown> = {
    command: 'status',
    running: true,
    pid,
    rpcConnected,
    onlineClients,
  };

  // Worker 守护状态
  if (guardianSnapshot) {
    output.guardian = {
      health: guardianSnapshot.health,
      restartCount: guardianSnapshot.restartCount,
      totalRestarts: guardianSnapshot.totalRestarts,
      startTime: guardianSnapshot.startTime
        ? new Date(guardianSnapshot.startTime).toISOString()
        : null,
      uptimeDisplay: workerManager!.getUptime()
        ? formatUptime(workerManager!.getUptime())
        : 'unknown',
      policy: guardianSnapshot.policy,
    };
  }

  // Worker 详细健康数据
  if (workerHealth) {
    output.workerHealth = {
      status: healthEmoji(workerHealth.health) + ' ' + workerHealth.health,
      pid: workerHealth.pid,
      uptime: formatUptime(workerHealth.uptime),
      memory: {
        rss: formatBytes(workerHealth.memory.rss),
        heapUsed: formatBytes(workerHealth.memory.heapUsed),
        heapTotal: formatBytes(workerHealth.memory.heapTotal),
        external: formatBytes(workerHealth.memory.external),
      },
      nodeVersion: workerHealth.nodeVersion,
      actionCount: workerHealth.status?.actionCount ?? 0,
      connectionState: workerHealth.status?.connectionState ?? 'unknown',
    };
  }

  if (workerQueryError) {
    output.workerQueryError = workerQueryError;
  }

  // 确定总体健康状态
  const guardianHealth = guardianSnapshot?.health ?? 'healthy';
  const workerStatusOk = workerHealth?.health === 'healthy';
  const overallHealth = !rpcConnected
    ? 'unhealthy'
    : !workerStatusOk && guardianHealth === 'degraded'
      ? 'degraded'
      : guardianHealth;

  output.overallHealth = overallHealth;

  // 警告
  const warnings: string[] = [];
  if (!rpcConnected) {
    warnings.push(
      'Worker 运行中但未连接到 Sekiro Server',
      '工具调用将会失败，请检查 rpc-go Server 状态',
    );
  }
  if (guardianSnapshot && guardianSnapshot.restartCount > 0) {
    warnings.push(
      `Worker 在最近 ${guardianSnapshot.policy.restartWindowMs / 1000}s 内重启了 ${guardianSnapshot.restartCount} 次`,
    );
  }
  if (guardianHealth === 'unhealthy') {
    warnings.push(
      `Worker 已达到最大重启次数 (${guardianSnapshot?.policy.maxRestarts})，不再自动重启`,
    );
  }
  if (workerQueryError) {
    warnings.push(`Worker 健康查询失败: ${workerQueryError}`);
  }

  if (warnings.length > 0) {
    output.warnings = warnings;
    output.status = overallHealth === 'healthy' ? 'warn' : 'error';
  } else if (overallHealth === 'healthy') {
    output.status = 'success';
  } else {
    output.status = 'warn';
  }

  return output;
};
