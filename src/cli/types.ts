/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 层共享类型：daemon 会话上下文与 daemon 协议数据形状。
 * 协议方法集与 worker 侧 src/ipc/daemonServer.ts 配对。
 */

import type {DaemonLike} from './daemonClient.js';

export interface WorkerContext {
  /** 会话名：argv -s/--session > env PROXYCLI_SESSION > 'default' */
  session: string;
  /** 测试注入：覆盖按 workspace-hash 计算的注册表目录 */
  daemonDir?: string;
  /** spawn detached daemon 时透传的 worker flag 白名单 */
  spawnFlags?: string[];
  /** 懒执行 ensureDaemon + connect，返回 daemon 连接 */
  connect: () => Promise<DaemonLike>;
}

export interface ToolRecovery {
  tool?: string;
  command?: string;
  reason: string;
}

export interface JobStatus {
  jobId: string;
  sessionId: string;
  tool?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'timed_out' | 'cancelled';
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    recovery?: ToolRecovery;
    details?: Record<string, unknown>;
  };
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}

export type BrowserConnectionMode =
  | 'attach'
  | 'ws-endpoint'
  | 'launch'
  | 'disconnected';

export interface BrowserConnectionStatus {
  connected: boolean;
  mode: BrowserConnectionMode;
  pages: number;
}

export interface BrowserConnectOptions {
  acceptInsecureCerts?: boolean;
  browserURL?: string;
  channel?: string;
  cloak?: boolean;
  executablePath?: string;
  force?: boolean;
  fullStealthArgs?: boolean;
  headless?: boolean;
  isolated?: boolean;
  jsStealth?: boolean;
  minimalStealth?: boolean;
  userDataDir?: string;
  viewport?: {width: number; height: number};
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
}

export interface BrowserDisconnectOptions {
  force?: boolean;
}
