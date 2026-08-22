/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ToolRecovery} from '../utils/errors.js';

export type JobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

const TERMINAL_JOB_STATUSES = new Set<JobStatus>([
  'done',
  'failed',
  'timed_out',
  'cancelled',
]);

export interface JobError {
  code: string;
  message: string;
  retryable?: boolean;
  recovery?: ToolRecovery;
  details?: Record<string, unknown>;
}

export interface Job {
  jobId: string;
  sessionId: string;
  tool: string;
  params: Record<string, unknown>;
  status: JobStatus;
  result?: unknown;
  error?: JobError;
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}

export interface JobStoreOptions {
  maxJobs?: number;
  retentionMs?: number;
  maxLogLines?: number;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly maxJobs: number;
  private readonly retentionMs: number;
  private readonly maxLogLines: number;

  constructor(options: JobStoreOptions = {}) {
    this.maxJobs = Math.max(1, options.maxJobs ?? 1000);
    this.retentionMs = Math.max(1, options.retentionMs ?? 60 * 60 * 1000);
    this.maxLogLines = Math.max(1, options.maxLogLines ?? 1000);
  }

  create(
    sessionId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Job {
    this.pruneExpired();
    this.ensureCapacity();
    const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const job: Job = {
      jobId,
      sessionId,
      tool,
      params,
      status: 'pending',
      logs: [],
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    return job;
  }

  get(jobId: string): Job {
    this.pruneExpired();
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    return job;
  }

  list(): Job[] {
    this.pruneExpired();
    return [...this.jobs.values()];
  }

  markRunning(jobId: string): void {
    this.get(jobId).status = 'running';
  }

  complete(jobId: string, result: unknown): void {
    const job = this.get(jobId);
    job.status = 'done';
    job.result = result;
    job.finishedAt = new Date().toISOString();
  }

  fail(jobId: string, error: JobError): void {
    this.finalize(jobId, 'failed', error);
  }

  markTimedOut(jobId: string, error: JobError): void {
    this.finalize(jobId, 'timed_out', error);
  }

  cancel(jobId: string, error: JobError): void {
    this.finalize(jobId, 'cancelled', error);
  }

  appendLog(jobId: string, line: string): void {
    const logs = this.get(jobId).logs;
    logs.push(line);
    if (logs.length > this.maxLogLines) {
      logs.splice(0, logs.length - this.maxLogLines);
    }
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - this.retentionMs;
    for (const [jobId, job] of this.jobs) {
      if (job.finishedAt && Date.parse(job.finishedAt) <= cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }

  private ensureCapacity(): void {
    if (this.jobs.size < this.maxJobs) return;
    for (const [jobId, job] of this.jobs) {
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        this.jobs.delete(jobId);
        if (this.jobs.size < this.maxJobs) return;
      }
    }
    throw new Error('JOB_STORE_FULL');
  }

  private finalize(
    jobId: string,
    status: 'failed' | 'timed_out' | 'cancelled',
    error: JobError,
  ): void {
    const job = this.get(jobId);
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
  }
}
