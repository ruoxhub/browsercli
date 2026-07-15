/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker REST routes
 *
 *  GET /api/health             — 进程存活探针
 *  GET /api/worker/status      — 聚合 WorkerFullStatus（worker / browser / hooks / tools）
 *  GET /api/worker/logs        — 占位（结构化日志总线 v3 接，目前返空）
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import type {Runtime} from '../../runtime.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {sendJson, sendUnexpected} from '../middleware/error.js';
import type {WorkerFullStatus, WorkerStatus} from '../types.js';

export interface WorkerRoutesConfig {
  runtime: Runtime;
  /** 工具上下文提供者，用于读取重连后的 browser 状态 */
  contextProvider?: ToolContextProvider;
  /** 启动时传入的 RPC 连接信息（来自 src/index.ts 的 workerStartContext） */
  group: string;
  rpcHost: string;
  /** package.json 版本号；ConsoleServer 启动时读出后注入 */
  version: string;
  /** 进程启动时间（ms）；用于计算 uptime */
  startedAt: number;
  /** 浏览器运行模式（attach / launch / standalone …） */
  browserMode: string;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

function buildWorkerStatus(cfg: WorkerRoutesConfig): WorkerStatus {
  return {
    ok: true,
    version: cfg.version,
    uptime: Date.now() - cfg.startedAt,
    pid: process.pid,
    rpcHost: cfg.rpcHost,
    group: cfg.group,
  };
}

function buildFullStatus(cfg: WorkerRoutesConfig): WorkerFullStatus {
  const {runtime} = cfg;
  const ctxProvider = cfg.contextProvider ?? runtime.contextProvider;

  let isConnected: boolean;
  let pages: number;
  try {
    const ctx =
      ctxProvider?.getContext() ?? runtime.browserManager.getContext();
    pages = ctx?.pages().length ?? 0;
    isConnected =
      ctxProvider?.isBrowserConnected() ?? runtime.browserManager.isConnected();
  } catch {
    isConnected = false;
    pages = 0;
  }

  const hookStats = runtime.hookManager.getStats();
  const totalHooks = hookStats.totalHooks;
  const activeHooks = hookStats.enabledHooks;
  const pausedHooks = hookStats.disabledHooks;

  return {
    ...buildWorkerStatus(cfg),
    browser: {
      connected: isConnected,
      mode: cfg.browserMode,
      pages,
      sessions: pages,
    },
    hooks: {
      total: totalHooks,
      active: activeHooks,
      paused: pausedHooks,
    },
    tools: {
      total: 0, // ConsoleServer 启动后，路由通过 toolMetaList 注入；占位 0
    },
  };
}

/**
 * Factory：传入一个能返回最新 ToolMeta 数量的回调（避免 routes 循环依赖 tools-meta）。
 */
export function createWorkerRoutes(
  cfg: WorkerRoutesConfig,
  getToolCount: () => number,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/health',
      (_req, res) => {
        sendJson(res, {ok: true, version: cfg.version});
      },
    ],
    [
      'GET /api/worker/status',
      (_req, res) => {
        try {
          const status = buildFullStatus(cfg);
          status.tools.total = getToolCount();
          sendJson(res, status);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/worker/logs',
      (_req, res) => {
        // v3 占位：等结构化日志总线落地。目前返回空数组，前端按 0 条处理。
        sendJson(res, {entries: [], note: '日志总线尚未启用'});
      },
    ],
  ]);
}
