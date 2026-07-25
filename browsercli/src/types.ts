/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerContext — 纯远程 CLI 层上下文，仅持有 HTTP 客户端与传输方式
 */

import type {WorkerHttpClient} from './WorkerHttpClient.js';

export interface WorkerContext {
  /** HTTP 传输模式下使用的 Worker 客户端（request-response 封装） */
  httpClient?: WorkerHttpClient;
  /** 传输方式：'http'（默认）= 纯 HTTP 客户端；'sekiro' = 旧 Sekiro RPC 路径 */
  transport: 'http' | 'sekiro';
}
