/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {setRuntime} from '../../../../src/runtime.js';
import {riskPanel} from '../../../../src/tools/analyzer/riskPanel.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

afterEach(() => setRuntime(undefined));

describe('risk_panel', () => {
  it('disables both AI-backed analyses when useAI is false', async () => {
    const analyzerInputs: unknown[] = [];
    const cryptoInputs: unknown[] = [];
    setRuntime({
      analyzer: {
        understand: async (input: unknown) => {
          analyzerInputs.push(input);
          return {securityRisks: []};
        },
      },
      cryptoDetector: {
        detect: async (input: unknown) => {
          cryptoInputs.push(input);
          return {algorithms: [], securityIssues: []};
        },
      },
      hookManager: {
        getAllKnownHookIds: () => [],
        getRecords: () => [],
      },
    } as never);
    const response = new ToolResponseAccumulator();

    await riskPanel.handler(
      {
        params: {
          code: 'const value = 1;',
          useAI: false,
          includeHookSignals: false,
        },
      },
      response,
      {} as never,
    );

    assert.deepEqual(analyzerInputs, [
      {code: 'const value = 1;', focus: 'security', useAI: false},
    ]);
    assert.deepEqual(cryptoInputs, [{code: 'const value = 1;', useAI: false}]);
    assert.equal(
      (response.toJSON().structuredContent as {success: boolean}).success,
      true,
    );
  });
});
