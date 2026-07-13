/**
 * @license Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Job {
  jobId: string;
  sessionId: string;
  tool: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: unknown;
  error?: {code: string; message: string};
  logs: string[];
  createdAt: string;
  finishedAt?: string;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(sessionId: string, tool: string, params: Record<string, unknown>): Job {
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
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    return job;
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

  fail(jobId: string, error: {code: string; message: string}): void {
    const job = this.get(jobId);
    job.status = 'failed';
    job.error = error;
    job.finishedAt = new Date().toISOString();
  }

  appendLog(jobId: string, line: string): void {
    this.get(jobId).logs.push(line);
  }
}
