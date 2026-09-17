/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

export interface ExtensionTabInfo {
  id: number;
  url?: string;
  title?: string;
  active: boolean;
  windowId?: number;
  groupId?: number;
  claimed: boolean;
  attached: boolean;
}

export interface ExtensionPingResult {
  status: string;
  transport?: 'native' | 'websocket' | null;
  attachedTabs: number[];
  claimedTabs: number[];
  timestamp: number;
}

export interface ExtensionCdpEventParams {
  tabId: number;
  sessionId?: string;
  method: string;
  params: Record<string, unknown>;
}

export interface ExtensionCdpDetachParams {
  tabId: number;
  reason: string;
}

export interface ExtensionTabLifecycleParams {
  tabId: number;
  url?: string;
  title?: string;
  status?: string;
}
