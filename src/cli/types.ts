/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerContext — CLI 层上下文，持有 SekiroInvoker 和解析后的配置
 */

import type {SekiroInvoker} from './sekiro-invoker.js';
import type {ResolvedConfig} from '../config.js';
import type {WorkerState} from '../index.js';

export interface WorkerContext {
  sekiroHost: string;
  group: string;
  invoker: SekiroInvoker;
  /** Worker 运行状态 */
  workerState: WorkerState;
  /** 解析后的完整配置（已合并配置文件、环境变量、默认值） */
  resolvedConfig: ResolvedConfig;
  /** 浏览器配置快捷访问 */
  config: {
    browserUrl?: string;
    wsEndpoint?: string;
    headless?: boolean;
    executablePath?: string;
  };
}
