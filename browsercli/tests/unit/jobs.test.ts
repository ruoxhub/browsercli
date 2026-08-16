/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {AxiError} from 'axi-sdk-js';

import {cliCommands} from '../../src/app.js';
import {jobsCommand} from '../../src/commands/jobs.js';
import type {AxiStructuredOutput} from '../../src/output.js';
import type {WorkerContext} from '../../src/types.js';
import type {JobStatus, WorkerHttpClient} from '../../src/WorkerHttpClient.js';

const runningJob: JobStatus = {
  jobId: 'job_1',
  sessionId: 'session_1',
  tool: 'fill',
  status: 'running',
  logs: [],
  createdAt: '2026-08-15T00:00:00.000Z',
};

function context() {
  const calls: string[] = [];
  const client = {
    listJobs: async () => {
      calls.push('list');
      return {jobs: [runningJob]};
    },
    cancelJob: async (jobId: string) => {
      calls.push(`cancel:${jobId}`);
      return {
        ...runningJob,
        jobId,
        status: 'cancelled' as const,
        error: {code: 'JOB_CANCELLED', message: 'cancelled'},
        finishedAt: '2026-08-15T00:01:00.000Z',
      };
    },
  } as unknown as WorkerHttpClient;
  return {
    calls,
    ctx: {httpClient: client, transport: 'http'} as WorkerContext,
  };
}

describe('jobsCommand', () => {
  it('registers jobs as a top-level command', () => {
    assert.strictEqual(cliCommands.jobs, jobsCommand);
  });

  it('lists jobs in table form by default', async () => {
    const {calls, ctx} = context();
    const output = (await jobsCommand(['list'], ctx)) as AxiStructuredOutput;

    assert.deepEqual(calls, ['list']);
    assert.deepEqual(output.headers, [
      'Job',
      'Tool',
      'Status',
      'Created',
      'Finished',
    ]);
    assert.equal(output.rows?.[0]?.[0], 'job_1');
  });

  it('cancels a job and supports JSON output', async () => {
    const {calls, ctx} = context();
    const output = (await jobsCommand(
      ['cancel', 'job_1', '--json'],
      ctx,
    )) as AxiStructuredOutput;

    assert.deepEqual(calls, ['cancel:job_1']);
    assert.equal(output.status, 'success');
    assert.equal(output.jobId, 'job_1');
    assert.equal(output.jobStatus, 'cancelled');
  });

  it('rejects malformed actions and flags before HTTP', async () => {
    for (const args of [
      [],
      ['list', 'extra'],
      ['cancel'],
      ['cancel', 'job_1', 'extra'],
      ['list', '--force'],
      ['unknown'],
    ]) {
      const {calls, ctx} = context();
      await assert.rejects(
        async () => jobsCommand(args, ctx),
        error => error instanceof AxiError && error.code === 'VALIDATION_ERROR',
      );
      assert.deepEqual(calls, []);
    }
  });
});
