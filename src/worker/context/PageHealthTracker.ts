/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export type PageHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNRESPONSIVE';

export interface PageHealthRecord {
  status: PageHealthStatus;
  consecutiveTimeouts: number;
  lastError?: string;
  lastUpdated: string;
}

export class PageHealthTracker {
  private readonly records = new Map<string, PageHealthRecord>();
  private readonly timeoutThreshold: number;

  constructor(timeoutThreshold = 2) {
    this.timeoutThreshold = Math.max(1, timeoutThreshold);
  }

  getRecord(pageId: string): PageHealthRecord {
    const existing = this.records.get(pageId);
    if (existing) return existing;

    const record: PageHealthRecord = {
      status: 'HEALTHY',
      consecutiveTimeouts: 0,
      lastUpdated: new Date().toISOString(),
    };
    this.records.set(pageId, record);
    return record;
  }

  recordSuccess(pageId: string): void {
    const record = this.getRecord(pageId);
    record.status = 'HEALTHY';
    record.consecutiveTimeouts = 0;
    record.lastError = undefined;
    record.lastUpdated = new Date().toISOString();
  }

  recordTimeout(pageId: string, error?: string): PageHealthRecord {
    const record = this.getRecord(pageId);
    record.consecutiveTimeouts += 1;
    record.lastError = error;
    record.lastUpdated = new Date().toISOString();

    if (record.consecutiveTimeouts >= this.timeoutThreshold) {
      record.status = 'UNRESPONSIVE';
    } else {
      record.status = 'DEGRADED';
    }
    return record;
  }

  markUnresponsive(pageId: string, error?: string): void {
    const record = this.getRecord(pageId);
    record.status = 'UNRESPONSIVE';
    record.consecutiveTimeouts = Math.max(
      record.consecutiveTimeouts,
      this.timeoutThreshold,
    );
    record.lastError = error;
    record.lastUpdated = new Date().toISOString();
  }

  isPageHealthy(pageId: string): boolean {
    return this.getRecord(pageId).status !== 'UNRESPONSIVE';
  }

  clear(pageId?: string): void {
    if (pageId) {
      this.records.delete(pageId);
    } else {
      this.records.clear();
    }
  }

  getAllRecords(): Record<string, PageHealthRecord> {
    const result: Record<string, PageHealthRecord> = {};
    for (const [id, rec] of this.records.entries()) {
      result[id] = {...rec};
    }
    return result;
  }
}

export const globalPageHealthTracker = new PageHealthTracker();
