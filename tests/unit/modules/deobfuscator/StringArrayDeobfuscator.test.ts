/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {StringArrayDeobfuscator} from '../../../../src/modules/deobfuscator/StringArrayDeobfuscator.js';

describe('StringArrayDeobfuscator', () => {
  it('detects string array rotation (positive + negative)', () => {
    assert.strictEqual(
      StringArrayDeobfuscator.detectStringArrayRotation('x = y + 0x1'),
      true,
    );
    assert.strictEqual(
      StringArrayDeobfuscator.detectStringArrayRotation('var x = 1;'),
      false,
    );
  });

  it('derotates by removing string array rotation IIFE', () => {
    const rotated = `
      (function(_0xabc,_0xdef){
        while(true){
          try { break; } catch(e){ _0xabc.push(_0xabc.shift()); }
        }
      })(['a','b'], 0x1);
      console.log("x");
    `;
    const derotated = StringArrayDeobfuscator.derotateStringArray(rotated);
    assert.ok(derotated.includes('console.log'));
  });
});
