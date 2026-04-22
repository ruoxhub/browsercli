/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerContext — 替代 DaemonContext
 *
 * CLI 层上下文，持有 SekiroInvoker、WorkerManager 和解析后的配置
 */

import type {SekiroInvoker} from './sekiro-invoker.js';
import type {WorkerManager} from './worker-manager.js';
import type {ResolvedConfig} from './global-config.js';

export interface WorkerContext {
  sekiroHost: string;
  group: string;
  invoker: SekiroInvoker;
  workerManager: WorkerManager;
  /** 解析后的完整配置（已合并配置文件、环境变量、默认值） */
  resolvedConfig: ResolvedConfig;
  /**
   * @deprecated 使用 resolvedConfig 代替
   */
  config: {
    browserUrl?: string;
    wsEndpoint?: string;
    headless?: boolean;
    executablePath?: string;
  };
}

/**
 * @deprecated 使用 WorkerContext 替代
 */
export type DaemonContext = WorkerContext;
