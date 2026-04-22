/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 平台层类型定义 — NodeClient、Worker、CLI 共用
 */

import type {ActionHandler} from './sekiro.js';

// ==================== NodeClient 配置 ====================

/** NodeClient 构造配置 */
interface NodeClientConfig {
  /** 分组名 */
  group: string;
  /** Sekiro Server 地址，如 ws://127.0.0.1:5612 */
  sekiroHost: string;
  /** 客户端 ID（默认自动生成） */
  clientId?: string;
  /** 重连基础间隔 ms */
  reconnectBaseDelay?: number;
  /** 重连最大间隔 ms */
  reconnectMaxDelay?: number;
  /** 心跳间隔 ms */
  heartbeatInterval?: number;
}

/** NodeClient 状态快照 */
interface ClientStatus {
  isInitialized: boolean;
  isConnected: boolean;
  connectionState: import('./sekiro').SekiroConnectionState;
  group: string;
  clientId: string;
  actionCount: number;
  sekiroHost: string;
}

// ==================== Worker 配置 ====================

/** Worker 启动选项 */
interface WorkerStartOptions {
  /** Sekiro Server 地址 */
  sekiroHost: string;
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
}

// ==================== Action 配置（兼容旧 BaseClient） ====================

/** 简单 Action 处理函数 */
type SimpleActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** Action 配置对象 */
interface ActionConfig {
  /** 处理方法 */
  method: (params: Record<string, unknown>) => Promise<unknown>;
  /** 可选的响应转换 */
  transform?: (response: unknown) => unknown;
}

export {
  type NodeClientConfig,
  type ClientStatus,
  type WorkerStartOptions,
  type SimpleActionHandler,
  type ActionConfig,
};
