/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {Deobfuscator} from '../../../src/modules/deobfuscator/Deobfuscator.js';

describe('Deobfuscator', () => {
  it('deobfuscates basic source and returns structured result', async () => {
    const deobfuscator = new Deobfuscator();
    const result = await deobfuscator.deobfuscate({
      code: 'function a(){return 1+2;} a();',
      aggressive: false,
      renameVariables: false,
      auto: false,
      unpack: false,
      advanced: false,
      jsvmp: false,
      astOptimize: false,
    });

    assert.ok(typeof result.code === 'string');
    assert.ok(Array.isArray(result.transformations));
    assert.ok(Array.isArray(result.obfuscationType));
  });

  it('decodes hex and unicode escape strings', async () => {
    const deobfuscator = new Deobfuscator();
    const result = await deobfuscator.deobfuscate({
      code: 'const a = "\\x48\\x65\\x6c\\x6c\\x6f\\x20\\u4e2d\\u6587";',
      aggressive: false,
      renameVariables: false,
      auto: false,
      unpack: false,
      advanced: false,
      jsvmp: false,
      astOptimize: false,
    });

    assert.ok(
      result.code.toLowerCase().includes('hello \\u4e2d\\u6587') ||
      result.code.includes('Hello 中文')
    );
  });
});
