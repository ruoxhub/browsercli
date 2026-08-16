/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {
  beginTrace,
  endTrace,
  getTraceChunks,
} from '../../../../src/tools/performance/traceState.js';

afterEach(endTrace);

describe('performance trace state', () => {
  it('serializes CDP trace event arrays as valid JSON', () => {
    let listener:
      | ((data: {method: string; params?: Record<string, unknown>}) => void)
      | undefined;
    const client = {
      on: (
        _event: string,
        handler: (data: {
          method: string;
          params?: Record<string, unknown>;
        }) => void,
      ) => {
        listener = handler;
      },
    };

    beginTrace(client as never);
    listener?.({
      method: 'Tracing.dataCollected',
      params: {value: [{name: 'navigationStart', ts: 123}]},
    });

    assert.deepEqual(JSON.parse(getTraceChunks().join('')), [
      {name: 'navigationStart', ts: 123},
    ]);
  });
});
