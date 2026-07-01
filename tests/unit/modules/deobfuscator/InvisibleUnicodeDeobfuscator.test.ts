/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {InvisibleUnicodeDeobfuscator} from '../../../../src/modules/deobfuscator/InvisibleUnicodeDeobfuscator.js';

describe('InvisibleUnicodeDeobfuscator', () => {
  it('detects invisible unicode presence (positive + negative)', () => {
    const zw = '\u200b\u200c\u200b\u200b\u200b\u200b\u200b\u200c'; // 01000001 => 'A'
    assert.strictEqual(
      InvisibleUnicodeDeobfuscator.detectInvisibleUnicode(`x${zw}y`),
      true,
    );
    assert.strictEqual(
      InvisibleUnicodeDeobfuscator.detectInvisibleUnicode('normal text'),
      false,
    );
  });

  it('decodes invisible unicode sequences to readable text', () => {
    // 01000001 binary => 65 => 'A'
    const zw = '\u200b\u200c\u200b\u200b\u200b\u200b\u200b\u200c';
    const decoded = InvisibleUnicodeDeobfuscator.decodeInvisibleUnicode(
      `const s="${zw}"`,
    );
    assert.ok(decoded.includes('A'));
  });

  it('detects and decodes string encoding', () => {
    assert.strictEqual(
      InvisibleUnicodeDeobfuscator.detectStringEncoding(
        'const x="\\x61\\u0062";',
      ),
      true,
    );
    assert.strictEqual(
      InvisibleUnicodeDeobfuscator.detectStringEncoding('const x="abc";'),
      false,
    );

    const decoded = InvisibleUnicodeDeobfuscator.decodeStrings(
      'const x = String.fromCharCode(65, 66);',
    );
    assert.ok(decoded.includes('AB'));
  });
});
