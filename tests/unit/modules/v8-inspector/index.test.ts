/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import * as v8Inspector from '../../../../src/modules/v8-inspector/index.js';

describe('v8-inspector public exports', () => {
  it('exposes the upstream runtime API from one entry point', () => {
    assert.deepEqual(Object.keys(v8Inspector).toSorted(), [
      'BytecodeExtractor',
      'DominatorTreeBuilder',
      'HeapSnapshotParser',
      'JITInspector',
      'V8InspectorClient',
      'VersionDetector',
      'collectTurboFanIRFromDir',
      'collectTurboFanIRIsolated',
      'discoverWasmScripts',
      'inspectWasmGc',
      'parseTurboFanJSON',
      'printNativeIgnitionBytecode',
    ]);
  });
});
