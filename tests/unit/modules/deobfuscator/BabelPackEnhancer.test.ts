/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';

import {unwrapBabelDefault} from '../../../../src/modules/deobfuscator/astUtils.js';
import {
  keyToLiteral,
  objectDecode,
  callExpressToLiteral,
} from '../../../../src/modules/deobfuscator/BabelPackEnhancer.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);

describe('BabelPackEnhancer', () => {
  it('keyToLiteral handles shorthand properties correctly', () => {
    const code = 'const a = 1; const obj = { a };';
    const ast = parser.parse(code);
    const {changed} = keyToLiteral(ast);
    assert.equal(changed, true);
    const output = generate(ast).code;
    assert.ok(output.includes('"a": a'));
  });

  it('objectDecode validates call/binary/logical operator wrapper param ordering', () => {
    // 1. Correct order subtraction: a - b
    const codeOk = `
      const obj = {
        sub: function(a, b) { return a - b; }
      };
      const res = obj.sub(10, 3);
    `;
    const astOk = parser.parse(codeOk);
    const resOk = objectDecode(astOk);
    assert.equal(resOk.changed, true);
    assert.ok(generate(astOk).code.includes('10 - 3'));

    // 2. Incorrect order subtraction: b - a (should skip, not replace with 10 - 3)
    const codeBad = `
      const obj = {
        sub: function(a, b) { return b - a; }
      };
      const res = obj.sub(10, 3);
    `;
    const astBad = parser.parse(codeBad);
    const resBad = objectDecode(astBad);
    assert.equal(resBad.changed, true); // keyToLiteral still changes it from obj.sub to obj["sub"], so changed is true
    assert.ok(generate(astBad).code.includes('obj["sub"](10, 3)'));
  });

  it('callExpressToLiteral is non-destructive on vm failures', () => {
    // A string array and helper decoder function, but VM execution will fail due to throwing an error
    const code = `
      function _0x5c1a() {
        const arr = ['a', 'b'];
        _0x5c1a = function() { return arr; };
        return _0x5c1a();
      }
      function decoder(a, b, c, d) {
        throw new Error("VM execution failure simulation");
      }
      console.log(decoder(1, 2, 3, 4));
    `;
    const ast = parser.parse(code);
    // Execute the pass returned by callExpressToLiteral factory
    const pass = callExpressToLiteral({vmTimeoutMs: 1000});
    const {changed} = pass(ast);
    assert.equal(changed, false);
    // Make sure decoder function is NOT removed
    const output = generate(ast).code;
    assert.ok(output.includes('function decoder'));
  });
});
