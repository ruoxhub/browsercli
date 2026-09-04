/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  TrafficSummary,
  WsDecodeMode,
} from '../../../../src/modules/network/types.js';

test('network/types defines TrafficSummary and WsDecodeMode cleanly', () => {
  const mode: WsDecodeMode = 'json';
  assert.equal(mode, 'json');

  const summary: TrafficSummary = {
    wsid: 1,
    url: 'wss://example.com/ws',
    durationMs: 100,
    totalFrames: 2,
    sentCount: 1,
    receivedCount: 1,
    groups: [],
    groupToIndices: new Map(),
  };
  assert.equal(summary.wsid, 1);
});
