/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

import {parseArgs} from '../args-parser.js';
import {toAxiError} from '../errors.js';
import {successOutput, tableOutput} from '../output.js';
import type {WorkerContext} from '../types.js';
import type {JobStatus} from '../types.js';

const ALLOWED_FLAGS = new Set(['json']);

function invalid(message: string): never {
  throw new AxiError(message, 'VALIDATION_ERROR', [
    '用法：browsercli jobs list [--json] | browsercli jobs cancel <job-id> [--json]',
  ]);
}

function parseJsonFlag(flags: Record<string, string | boolean>): boolean {
  const unknown = Object.keys(flags).find(key => !ALLOWED_FLAGS.has(key));
  if (unknown) invalid(`未知参数：--${unknown}`);
  const value = flags.json;
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (['true', '1', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(value.toLowerCase())) return false;
  return invalid('--json 必须是 true 或 false');
}

function jobRows(jobs: JobStatus[]): string[][] {
  return jobs.map(job => [
    job.jobId,
    job.tool ?? '',
    job.status,
    job.createdAt,
    job.finishedAt ?? '',
  ]);
}

function renderJobs(
  action: 'list' | 'cancel',
  jobs: JobStatus[],
  json: boolean,
) {
  if (json) {
    const job = jobs[0];
    return successOutput(
      action === 'list'
        ? {command: 'jobs', action, jobs}
        : {
            command: 'jobs',
            action,
            jobId: job?.jobId,
            jobStatus: job?.status,
            job,
          },
    );
  }
  return {
    ...tableOutput(
      ['Job', 'Tool', 'Status', 'Created', 'Finished'],
      jobRows(jobs),
    ),
    command: 'jobs',
    action,
    jobs,
  };
}

export const jobsCommand: AxiCliCommand<WorkerContext> = async (args, ctx) => {
  const parsed = parseArgs(args);
  const action = parsed.positionals[0];
  const json = parseJsonFlag(parsed.flags);
  if (
    (action === 'list' && parsed.positionals.length !== 1) ||
    (action === 'cancel' && parsed.positionals.length !== 2) ||
    !['list', 'cancel'].includes(action)
  ) {
    invalid('jobs 动作必须是 list，或 cancel <job-id>');
  }

  if (!ctx) throw new AxiError('Worker 未运行', 'WORKER_NOT_RUNNING');

  const client = await ctx.connect();
  try {
    if (action === 'list') {
      const {jobs} = await client.request<{jobs: JobStatus[]}>('jobs.list');
      return renderJobs('list', jobs, json);
    }
    const job = await client.request<JobStatus>('jobs.cancel', {
      jobId: parsed.positionals[1],
    });
    return renderJobs('cancel', [job], json);
  } catch (error) {
    throw toAxiError(error, 'JOB_ERROR');
  } finally {
    client.close();
  }
};
