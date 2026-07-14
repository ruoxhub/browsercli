/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sekiro 协议类型定义
 */

/** Sekiro 请求（Server → Client） */
export interface RpcRequest {
  __sekiro_seq__: string;
  action: string;
  params?: Record<string, unknown>;
}

/** Sekiro 响应（Client → Server） */
export interface RpcResponse {
  code?: number;
  status?: number;
  message?: string;
  data?: unknown;
  __sekiro_seq__: string;
}

/** Action 处理函数签名 */
export type ActionHandler = (
  request: RpcRequest,
  resolve: (response: unknown) => void,
  reject: (errorMessage: string) => void,
) => void;

/** SekiroClient 连接状态 */
export type RpcConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';
