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
    assert.equal(job.params.a, 1);
    assert.equal(job.status, 'pending');
    assert.ok(job.jobId.startsWith('job_'));
    assert.ok(job.createdAt);
    assert.deepEqual(job.logs, []);
    assert.equal(store.get(job.jobId)?.jobId, job.jobId);
  });

  it('lists jobs in creation order', () => {
    const first = store.create('s', 'first', {});
    const second = store.create('s', 'second', {});

    assert.deepEqual(
      store.list().map(job => job.jobId),
      [first.jobId, second.jobId],
    );
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

  it('records timed-out jobs as terminal with an error', () => {
    const job = store.create('s', 't', {});
    store.markTimedOut(job.jobId, {
      code: 'JOB_TIMEOUT',
      message: 'deadline exceeded',
    });

    const got = store.get(job.jobId);
    assert.equal(got.status, 'timed_out');
    assert.deepEqual(got.error, {
      code: 'JOB_TIMEOUT',
      message: 'deadline exceeded',
    });
    assert.ok(got.finishedAt);
  });

  it('records cancelled jobs as terminal with an error', () => {
    const job = store.create('s', 't', {});
    store.cancel(job.jobId, {
      code: 'JOB_CANCELLED',
      message: 'cancelled by user',
    });

    const got = store.get(job.jobId);
    assert.equal(got.status, 'cancelled');
    assert.deepEqual(got.error, {
      code: 'JOB_CANCELLED',
      message: 'cancelled by user',
    });
    assert.ok(got.finishedAt);
  });

  it('appends logs', () => {
    const job = store.create('s', 't', {});
    store.appendLog(job.jobId, 'line1');
    store.appendLog(job.jobId, 'line2');
    assert.deepEqual(store.get(job.jobId)!.logs, ['line1', 'line2']);
  });

  it('evicts the oldest terminal job at capacity', () => {
    const bounded = new JobStore({maxJobs: 2});
    const first = bounded.create('s', 'first', {});
    bounded.complete(first.jobId, {ok: true});
    const second = bounded.create('s', 'second', {});
    const third = bounded.create('s', 'third', {});

    assert.throws(() => bounded.get(first.jobId), /JOB_NOT_FOUND/);
    assert.equal(bounded.get(second.jobId).status, 'pending');
    assert.equal(bounded.get(third.jobId).status, 'pending');
  });

  it('evicts timed-out and cancelled jobs at capacity', () => {
    for (const terminal of ['timed_out', 'cancelled'] as const) {
      const bounded = new JobStore({maxJobs: 1});
      const job = bounded.create('s', terminal, {});
      const error = {code: terminal, message: terminal};
      if (terminal === 'timed_out') bounded.markTimedOut(job.jobId, error);
      else bounded.cancel(job.jobId, error);

      const replacement = bounded.create('s', 'replacement', {});
      assert.throws(() => bounded.get(job.jobId), /JOB_NOT_FOUND/);
      assert.equal(bounded.get(replacement.jobId).status, 'pending');
    }
  });

  it('rejects a new job instead of dropping active jobs at capacity', () => {
    const bounded = new JobStore({maxJobs: 2});
    bounded.create('s', 'first', {});
    bounded.create('s', 'second', {});

    assert.throws(() => bounded.create('s', 'third', {}), /JOB_STORE_FULL/);
  });

  it('keeps only the newest configured log lines', () => {
    const bounded = new JobStore({maxLogLines: 2});
    const job = bounded.create('s', 't', {});
    bounded.appendLog(job.jobId, 'line1');
    bounded.appendLog(job.jobId, 'line2');
    bounded.appendLog(job.jobId, 'line3');

    assert.deepEqual(bounded.get(job.jobId).logs, ['line2', 'line3']);
  });

  it('removes expired terminal jobs on access', async () => {
    const bounded = new JobStore({retentionMs: 1});
    const job = bounded.create('s', 't', {});
    bounded.complete(job.jobId, {ok: true});

    await new Promise(resolve => setTimeout(resolve, 10));

    assert.throws(() => bounded.get(job.jobId), /JOB_NOT_FOUND/);
  });
});
