/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 平台层类型定义 — RpcClient、Worker、CLI 共用
 */

import type {ActionHandler} from './rpc.js';

// ==================== RpcClient 配置 ====================

/** RpcClient 构造配置 */
interface RpcClientConfig {
  /** 分组名 */
  group: string;
  /** rpc Server 地址，如 ws://127.0.0.1:5612 */
  rpcHost: string;
  /** 客户端 ID（默认自动生成） */
  clientId?: string;
  /** 重连基础间隔 ms */
  reconnectBaseDelay?: number;
  /** 重连最大间隔 ms */
  reconnectMaxDelay?: number;
  /** 心跳间隔 ms */
  heartbeatInterval?: number;
  /** pong 超时 ms，超时后主动断开重连 */
  pongTimeout?: number;
}

/** RpcClient 状态快照 */
interface ClientStatus {
  isInitialized: boolean;
  isConnected: boolean;
  connectionState: import('./rpc.js').RpcConnectionState;
  group: string;
  clientId: string;
  actionCount: number;
  rpcHost: string;
}

// ==================== Worker 配置 ====================

/** Worker 启动选项 */
interface WorkerStartOptions {
  /** rpc Server 地址 */
  rpcHost: string;
  /** 分组名 */
  group: string;
  /** 浏览器调试 URL */
  browserUrl?: string;
  /** WebSocket 端点 */
  wsEndpoint?: string;
  /** 是否无头模式 */
  headless?: boolean;
  /** 浏览器可执行路径 */
  executablePath?: string;
  /** PostgreSQL 连接字符串 */
  databaseUrl?: string;
  /** Trace 输出模式: errors 或 all */
  traceOutput?: 'errors' | 'all';
  /** 启用 CloakBrowser 二进制 + 49 C++ patch；profile 切到 cloak-profile。 */
  cloak?: boolean;
  /** Opt-in StealthScripts2025 JS 注入（默认不注入）。 */
  jsStealth?: boolean;
  /** 回退到历史 60+ 启动参数集（默认不启用）。 */
  fullStealthArgs?: boolean;
}

// ==================== Action 配置（兼容旧 BaseClient） ====================

/** 简单 Action 处理函数 */
type SimpleActionHandler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

/** Action 配置对象 */
interface ActionConfig {
  /** 处理方法 */
  method: (params: Record<string, unknown>) => Promise<unknown>;
  /** 可选的响应转换 */
  transform?: (response: unknown) => unknown;
}

export {
  type RpcClientConfig,
  type ClientStatus,
  type WorkerStartOptions,
  type SimpleActionHandler,
  type ActionConfig,
};
