/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export type SessionStatus =
  | 'idle'
  | 'capturing'
  | 'paused'
  | 'analyzing'
  | 'completed'
  | 'stopped'
  | 'error';

export type CaptureSource = 'cdp' | 'proxy';

export type HookType =
  | 'fetch'
  | 'xhr'
  | 'crypto'
  | 'crypto_lib'
  | 'cookie'
  | 'storage'
  | 'websocket'
  | 'wasm';

export type StorageKind = 'cookie' | 'local' | 'session';

export interface SessionRow {
  id: string;
  name: string;
  targetUrl: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  meta: string | null;
}

export interface CapturedRequestRow {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  source: CaptureSource;
  requestHeaders: string;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: string | null;
  responseBody: string | null;
  contentType: string | null;
  initiator: string | null;
  durationMs: number;
  isStreaming: number;
  isWebSocket: number;
  truncated: number;
}

export interface HookRecordRow {
  sessionId: string;
  timestamp: number;
  hookType: HookType;
  functionName: string;
  arguments: string;
  result: string | null;
  callStack: string | null;
}

export interface StorageSnapshotRow {
  sessionId: string;
  timestamp: number;
  kind: StorageKind;
  origin: string;
  key: string;
  value: string | null;
}

export type CapturedRequestInput = Omit<
  CapturedRequestRow,
  'id' | 'sessionId' | 'sequence'
>;

/**
 * 列表/推送用的摘要投影：刻意排除 requestHeaders / requestBody /
 * responseHeaders / responseBody，避免整行出网（spec §8 / §9 / R2）。
 */
export interface CapturedRequestSummary {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  source: CaptureSource;
  initiator: string | null;
  truncated: number;
  isStreaming: number;
}

export type HookRecordInput = Omit<HookRecordRow, 'sessionId'>;

export type StorageSnapshotInput = Omit<StorageSnapshotRow, 'sessionId'>;

export interface AiReportRow {
  id: string;
  sessionId: string;
  mode: string;
  sceneHints: string | null;
  purifiedSummary: string | null;
  reportMarkdown: string;
  messages: string;
  createdAt: number;
}

export type AiReportInput = Omit<AiReportRow, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

export interface RequestFilter {
  sources?: CaptureSource[];
  urlFilter?: string;
}
