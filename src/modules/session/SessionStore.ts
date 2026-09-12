/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AiReportRow,
  CapturedRequestRow,
  CapturedRequestSummary,
  HookRecordRow,
  RequestFilter,
  SessionRow,
  SessionStatus,
  StorageSnapshotRow,
} from './types.js';

export interface SessionStore {
  createSession(input: {
    id: string;
    name: string;
    targetUrl?: string | null;
  }): SessionRow;
  updateSessionStatus(id: string, status: SessionStatus): void;
  getSession(id: string): SessionRow | null;
  listSessions(): SessionRow[];
  appendRequest(row: CapturedRequestRow): void;
  appendHook(row: HookRecordRow): void;
  appendSnapshot(row: StorageSnapshotRow): void;
  getRequests(sessionId: string, filter?: RequestFilter): CapturedRequestRow[];
  getRequest(id: string): CapturedRequestRow | null;
  listRequestSummaries(
    sessionId: string,
    filter?: RequestFilter,
    page?: {limit?: number; offset?: number},
  ): CapturedRequestSummary[];
  /** 统计匹配 filter 的请求数（不加载 body/headers，供分页 total 使用）。 */
  countRequests(sessionId: string, filter?: RequestFilter): number;
  /** 按 sequence 淘汰最旧行，只保留最新 keepLast 条；返回删除行数。 */
  trimRequests(sessionId: string, keepLast: number): number;
  /** 清空指定会话的全部捕获请求；返回删除行数。 */
  clearRequests(sessionId: string): number;
  getHooks(sessionId: string): HookRecordRow[];
  getSnapshots(sessionId: string): StorageSnapshotRow[];
  saveReport(row: AiReportRow): void;
  getReport(id: string): AiReportRow | null;
  getReports(sessionId: string): AiReportRow[];
  close(): void;
}
