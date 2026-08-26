/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** 服务器回调产生的原始捕获记录（无稳定 id）。 */
export interface CapturedExchange {
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  isOptions: boolean;
  isStatic: boolean;
  isStreaming: boolean;
  isWebSocket: boolean;
  truncated: boolean;
  timestamp: number;
}

/** ProxyStore 中带稳定 id 的存储记录。 */
export type CapturedRequest = CapturedExchange & {id: number};

/** MitmModule 各方法统一返回结构。 */
export interface MitmMethodResult<T> {
  success: boolean;
  message: string;
  data: T;
}

// ─── 工具参数与结果类型 ──────────────────────────────

export interface StartMitmProxyParams {
  port?: number;
}

export interface StartMitmProxyData {
  port: number;
  caCertPath: string;
  caInitialized: boolean;
}

export interface MitmProxyStatusData {
  running: boolean;
  port: number | null;
  capturedCount: number;
}

export interface ListMitmRequestsParams {
  pageSize?: number;
  pageIdx?: number;
  urlFilter?: string;
}

export interface MitmRequestSummary {
  id: number;
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  timestamp: number;
}

export interface ListMitmRequestsData {
  requests: MitmRequestSummary[];
  total: number;
  pageIdx: number;
  pageSize: number | undefined;
}

export interface GetMitmRequestParams {
  id: number;
  saveTo?: string;
}

export interface GetMitmRequestData {
  id: number;
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  isStatic: boolean;
  isStreaming: boolean;
  isWebSocket: boolean;
  truncated: boolean;
  timestamp: number;
  savedPath?: string;
}

export interface ClearMitmRequestsData {
  clearedCount: number;
}

export interface ExportMitmCaParams {
  format: 'pem' | 'der';
  outputPath: string;
}

export interface ExportMitmCaData {
  format: 'pem' | 'der';
  outputPath: string;
  bytes: number;
}
