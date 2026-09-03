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
import type {DaemonEvent, DaemonLike} from '../../src/daemonClient.js';
import type {AxiStructuredOutput} from '../../src/output.js';
import type {JobStatus, WorkerContext} from '../../src/types.js';

const runningJob: JobStatus = {
  jobId: 'job_1',
  sessionId: 'session_1',
  tool: 'fill',
  status: 'running',
  logs: [],
  createdAt: '2026-08-15T00:00:00.000Z',
};

function context() {
  const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
  const client: DaemonLike = {
    async request<T>(method: string, params?: Record<string, unknown>) {
      calls.push({method, params});
      if (method === 'jobs.list') return {jobs: [runningJob]} as T;
      if (method === 'jobs.cancel') {
        return {
          ...runningJob,
          jobId: String(params?.jobId ?? ''),
          status: 'cancelled',
          error: {code: 'JOB_CANCELLED', message: 'cancelled'},
          finishedAt: '2026-08-15T00:01:00.000Z',
        } as T;
      }
      return {} as T;
    },
    onEvent(_cb: (event: DaemonEvent) => void) {
      return () => undefined;
    },
    close() {},
  };
  const ctx: WorkerContext = {
    session: 'default',
    connect: async () => client,
  };
  return {calls, ctx};
}

describe('jobsCommand', () => {
  it('registers jobs as a top-level command', () => {
    assert.strictEqual(cliCommands.jobs, jobsCommand);
  });

  it('lists jobs via jobs.list in table form by default', async () => {
    const {calls, ctx} = context();
    const output = (await jobsCommand(['list'], ctx)) as AxiStructuredOutput;

    assert.deepEqual(calls, [{method: 'jobs.list', params: undefined}]);
    assert.deepEqual(output.headers, [
      'Job',
      'Tool',
      'Status',
      'Created',
      'Finished',
    ]);
    assert.equal(output.rows?.[0]?.[0], 'job_1');
  });

  it('cancels a job via jobs.cancel and supports JSON output', async () => {
    const {calls, ctx} = context();
    const output = (await jobsCommand(
      ['cancel', 'job_1', '--json'],
      ctx,
    )) as AxiStructuredOutput;

    assert.deepEqual(calls, [
      {method: 'jobs.cancel', params: {jobId: 'job_1'}},
    ]);
    assert.equal(output.status, 'success');
    assert.equal(output.jobId, 'job_1');
    assert.equal(output.jobStatus, 'cancelled');
  });

  it('rejects malformed actions and flags before connecting', async () => {
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
