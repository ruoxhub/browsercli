/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ControlFlowDeobfuscator} from '../../../../src/modules/deobfuscator/ControlFlowDeobfuscator.js';

describe('ControlFlowDeobfuscator', () => {
  it('detects control flow flattening (positive + negative)', () => {
    assert.strictEqual(
      ControlFlowDeobfuscator.detectControlFlowFlattening(
        'while(!![]){switch(x){case 1:break;}}',
      ),
      true,
    );
    assert.strictEqual(
      ControlFlowDeobfuscator.detectControlFlowFlattening('var x = 1;'),
      false,
    );
  });

  it('returns original code when LLM is unavailable', async () => {
    const deob = new ControlFlowDeobfuscator();
    const out = await deob.unflattenControlFlow('const x=1;');
    assert.strictEqual(out, 'const x=1;');
  });
});
