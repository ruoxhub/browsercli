/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {DeadCodeDeobfuscator} from '../../../../src/modules/deobfuscator/DeadCodeDeobfuscator.js';

describe('DeadCodeDeobfuscator', () => {
  it('detects dead code injection (positive + negative)', () => {
    assert.strictEqual(
      DeadCodeDeobfuscator.detectDeadCodeInjection('if(false){x()}'),
      true,
    );
    assert.strictEqual(
      DeadCodeDeobfuscator.detectDeadCodeInjection('if(x){y()}'),
      false,
    );
  });

  it('removes dead code blocks and unreachable code', () => {
    const out = DeadCodeDeobfuscator.removeDeadCode(
      'function f(){ if(false){a()} else {b()} if(true){c()} return 1; d(); }',
    );
    assert.ok(!out.includes('if (false)'));
    assert.ok(!out.includes('d();'));
  });
});
