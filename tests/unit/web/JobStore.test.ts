/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// tests/unit/web/JobStore.test.ts
import assert from 'node:assert/strict';
import {describe, it, beforeEach} from 'node:test';

import {JobStore} from '../../../src/worker/JobStore.js';

describe('JobStore', () => {
  let store: JobStore;
  beforeEach(() => {
    store = new JobStore();
  });

  it('creates a pending job and returns it', () => {
    const job = store.create('sess1', 'my_tool', {a: 1});
    assert.equal(job.sessionId, 'sess1');
    assert.equal(job.tool, 'my_tool');
    assert.equal((job.params as any).a, 1);
    assert.equal(job.status, 'pending');
    assert.ok(job.jobId.startsWith('job_'));
    assert.ok(job.createdAt);
    assert.deepEqual(job.logs, []);
    assert.equal(store.get(job.jobId)?.jobId, job.jobId);
  });

  it('transitions pending -> running -> done with result', async () => {
    const job = store.create('s', 't', {});
    store.markRunning(job.jobId);
    assert.equal(store.get(job.jobId)!.status, 'running');
    store.complete(job.jobId, {ok: true});
    const got = store.get(job.jobId)!;
    assert.equal(got.status, 'done');
    assert.deepEqual(got.result, {ok: true});
    assert.ok(got.finishedAt);
  });

  it('transitions to failed with error and unknown job throws', () => {
    const job = store.create('s', 't', {});
    store.fail(job.jobId, {code: 'X', message: 'boom'});
    const got = store.get(job.jobId)!;
    assert.equal(got.status, 'failed');
    assert.equal(got.error?.message, 'boom');
    assert.throws(() => store.get('job_nope'), /JOB_NOT_FOUND/);
  });

  it('appends logs', () => {
    const job = store.create('s', 't', {});
    store.appendLog(job.jobId, 'line1');
    store.appendLog(job.jobId, 'line2');
    assert.deepEqual(store.get(job.jobId)!.logs, ['line1', 'line2']);
  });
});
