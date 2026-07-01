/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {OpaquePredicateDeobfuscator} from '../../../../src/modules/deobfuscator/OpaquePredicateDeobfuscator.js';

describe('OpaquePredicateDeobfuscator', () => {
  it('detects opaque predicates (positive + negative)', () => {
    assert.strictEqual(
      OpaquePredicateDeobfuscator.detectOpaquePredicates('if(5>3){x()}'),
      true,
    );
    assert.strictEqual(
      OpaquePredicateDeobfuscator.detectOpaquePredicates('if(x>y){x()}'),
      false,
    );
  });

  it('removes always-true and always-false opaque predicates', () => {
    const out = OpaquePredicateDeobfuscator.removeOpaquePredicates(
      'if(5>3){a()} if(1===2){b()}',
    );
    assert.ok(out.includes('a()'));
    assert.ok(!out.includes('if (1 === 2)'));
  });
});
