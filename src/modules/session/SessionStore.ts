/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AiReportRow,
  CapturedRequestRow,
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
  getHooks(sessionId: string): HookRecordRow[];
  getSnapshots(sessionId: string): StorageSnapshotRow[];
  saveReport(row: AiReportRow): void;
  getReport(id: string): AiReportRow | null;
  getReports(sessionId: string): AiReportRow[];
  close(): void;
}
