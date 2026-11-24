/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {performance} from 'node:perf_hooks';
import {describe, it} from 'node:test';

import {CodeCompressor} from '../../src/modules/collector/CodeCompressor.js';

const runPerf = process.env.RUN_PERF_TESTS === 'true';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

describe('Performance Baseline', {skip: !runPerf}, () => {
  it('keeps compressor p95 under baseline threshold', async () => {
    const compressor = new CodeCompressor();
    const source = 'function x(){return "token";}\n'.repeat(12_000);
    const timings: number[] = [];

    for (let i = 0; i < 8; i += 1) {
      const start = performance.now();
      const result = await compressor.compress(source);
      timings.push(performance.now() - start);
      assert.ok(result.compressedSize > 0);
    }

    assert.ok(percentile(timings, 95) < 2500);
  });
});
