/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {exportSessionReport} from '../../../../src/tools/analyzer/reports.js';

describe('analyzer reports', () => {
  it('exports signature workflow evidence and remaining gaps', () => {
    const result = exportSessionReport({
      format: 'json',
      workflowSteps: ['list_network_requests', 'xhr_to_js_breakpoint'],
      requestFingerprints: [
        {
          reqid: 1,
          method: 'POST',
          url: 'https://example.test/api/order',
          signatureIndicators: ['x-sign'],
        },
      ],
      evidence: {
        hookRecords: 0,
        pausedFrames: [{functionName: 'makeSign'}],
      },
      gaps: ['Hook captured no records'],
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.data?.workflowSteps, [
      'list_network_requests',
      'xhr_to_js_breakpoint',
    ]);
    assert.deepEqual(result.data?.requestFingerprints, [
      {
        reqid: 1,
        method: 'POST',
        url: 'https://example.test/api/order',
        signatureIndicators: ['x-sign'],
      },
    ]);
    assert.deepEqual(result.data?.gaps, ['Hook captured no records']);
  });
});
