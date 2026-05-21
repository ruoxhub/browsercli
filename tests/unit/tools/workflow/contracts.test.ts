/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {builtinWorkflowContracts} from '../../../../src/tools/workflow/builtin-contracts.js';

test('builtin workflow contracts expose stable ids and route metadata', () => {
  const ids = builtinWorkflowContracts.map(contract => contract.id);
  assert.deepEqual(ids.sort(), [
    'auto-hook',
    'observe-flow',
    'rebuild-bundle',
    'trace-signature-generation',
  ]);

  for (const contract of builtinWorkflowContracts) {
    assert.equal(contract.kind, 'workflow-contract');
    assert.equal(contract.version, 1);
    assert.ok(contract.route.patterns.length > 0);
    assert.ok(contract.steps.length > 0);
  }
});

test('auto-hook contract declares observe before inject dependency', () => {
  const contract = builtinWorkflowContracts.find(
    item => item.id === 'auto-hook',
  );
  assert.ok(contract);
  assert.deepEqual(
    contract.steps.map(step => step.toolName),
    ['observeFlow', 'createHook', 'injectHook'],
  );
});
