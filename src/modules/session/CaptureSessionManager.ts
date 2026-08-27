/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {randomUUID} from 'node:crypto';

import type {SessionStore} from './SessionStore.js';
import type {
  AiReportInput,
  AiReportRow,
  CapturedRequestRow,
  HookRecordRow,
  RequestFilter,
  SessionRow,
  SessionStatus,
  StorageSnapshotRow,
} from './types.js';

const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  idle: ['capturing'],
  capturing: ['paused', 'analyzing', 'completed', 'stopped', 'error'],
  paused: ['capturing', 'stopped', 'error'],
  analyzing: ['completed', 'error'],
  completed: [],
  stopped: [],
  error: [],
};

export class CaptureSessionManager {
  private activeSessionId: string | null = null;
  private readonly sequences = new Map<string, number>();

  constructor(private readonly store: SessionStore) {}

  createSession(input: {name: string; targetUrl?: string}): SessionRow {
    const id = randomUUID();
    const row = this.store.createSession({
      id,
      name: input.name,
      targetUrl: input.targetUrl ?? null,
    });
    this.activeSessionId = id;
    this.sequences.set(id, 0);
    return row;
  }

  getActiveSession(): SessionRow | null {
    return this.activeSessionId
      ? this.store.getSession(this.activeSessionId)
      : null;
  }

  requireActiveSession(): SessionRow {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error('No active session. Call session_create first.');
    }
    return session;
  }

  listSessions(): SessionRow[] {
    return this.store.listSessions();
  }

  getSession(id: string): SessionRow | null {
    return this.store.getSession(id);
  }

  transition(id: string, status: SessionStatus): void {
    const current = this.store.getSession(id);
    if (!current) {
      throw new Error(`Session not found: ${id}`);
    }
    if (!ALLOWED[current.status].includes(status)) {
      throw new Error(
        `Invalid session transition: ${current.status} -> ${status}`,
      );
    }
    this.store.updateSessionStatus(id, status);
  }

  nextSequence(sessionId: string): number {
    const next = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, next);
    return next;
  }

  getRequests(sessionId: string, filter?: RequestFilter): CapturedRequestRow[] {
    return this.store.getRequests(sessionId, filter);
  }

  getHooks(sessionId: string): HookRecordRow[] {
    return this.store.getHooks(sessionId);
  }

  getSnapshots(sessionId: string): StorageSnapshotRow[] {
    return this.store.getSnapshots(sessionId);
  }

  saveReport(input: AiReportInput): AiReportRow {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? Date.now();
    const row: AiReportRow = {
      ...input,
      id,
      createdAt,
    };
    this.store.saveReport(row);
    return row;
  }

  getReport(id: string): AiReportRow | null {
    return this.store.getReport(id);
  }

  getReports(sessionId: string): AiReportRow[] {
    return this.store.getReports(sessionId);
  }
}
