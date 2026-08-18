/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PageHealthTracker} from '../../../src/worker/context/PageHealthTracker.js';

describe('PageHealthTracker', () => {
  it('initializes pages as HEALTHY', () => {
    const tracker = new PageHealthTracker();
    const record = tracker.getRecord('page-1');
    assert.equal(record.status, 'HEALTHY');
    assert.equal(record.consecutiveTimeouts, 0);
    assert.equal(tracker.isPageHealthy('page-1'), true);
  });

  it('marks as DEGRADED on first timeout, and UNRESPONSIVE on second', () => {
    const tracker = new PageHealthTracker(2);

    const rec1 = tracker.recordTimeout('page-1', 'timeout-1');
    assert.equal(rec1.status, 'DEGRADED');
    assert.equal(rec1.consecutiveTimeouts, 1);
    assert.equal(tracker.isPageHealthy('page-1'), true);

    const rec2 = tracker.recordTimeout('page-1', 'timeout-2');
    assert.equal(rec2.status, 'UNRESPONSIVE');
    assert.equal(rec2.consecutiveTimeouts, 2);
    assert.equal(tracker.isPageHealthy('page-1'), false);
  });

  it('resets to HEALTHY on success', () => {
    const tracker = new PageHealthTracker(2);
    tracker.recordTimeout('page-1');
    tracker.recordTimeout('page-1');
    assert.equal(tracker.isPageHealthy('page-1'), false);

    tracker.recordSuccess('page-1');
    const rec = tracker.getRecord('page-1');
    assert.equal(rec.status, 'HEALTHY');
    assert.equal(rec.consecutiveTimeouts, 0);
    assert.equal(tracker.isPageHealthy('page-1'), true);
  });

  it('supports direct markUnresponsive and clear', () => {
    const tracker = new PageHealthTracker();
    tracker.markUnresponsive('page-1', 'manual-mark');
    assert.equal(tracker.isPageHealthy('page-1'), false);

    tracker.clear('page-1');
    assert.equal(tracker.isPageHealthy('page-1'), true);
  });
});
