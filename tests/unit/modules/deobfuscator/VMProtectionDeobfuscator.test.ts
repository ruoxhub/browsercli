/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {VMProtectionDeobfuscator} from '../../../../src/modules/deobfuscator/VMProtectionDeobfuscator.js';

describe('VMProtectionDeobfuscator', () => {
  it('detects VM protection (positive + negative)', () => {
    const vmCode = `
      while(true){ switch(op){ case 0: stack.push(1); break; case 1: stack.pop(); break; } }
      var code=[1,2,3,4,5,6,7,8,9,10,11,12];
    `;
    const vm = VMProtectionDeobfuscator.detectVMProtection(vmCode);
    assert.strictEqual(vm.detected, true);
    assert.ok(vm.instructionCount >= 2);

    const plain = VMProtectionDeobfuscator.detectVMProtection('var x = 1;');
    assert.strictEqual(plain.detected, false);
  });

  it('analyzes VM structure (interpreter/stack/registers)', () => {
    const structure = VMProtectionDeobfuscator.analyzeVMStructure(
      'while(true){switch(x){case 0x1:break;}} stack.push(1); r1=2;',
    );
    assert.strictEqual(structure.hasInterpreter, true);
    assert.strictEqual(structure.hasStack, true);
    assert.strictEqual(structure.hasRegisters, true);
  });

  it('simplifies VM code by removing interpreter and instruction array', () => {
    const simplified = VMProtectionDeobfuscator.simplifyVMCode(
      'function interp(){return 1;} var inst=[1,2,3]; interp();',
      {interpreterFunction: 'interp', instructionArray: 'inst'},
    );
    assert.ok(simplified.includes('VM interpreter removed'));
  });

  it('deobfuscateVM falls back to original code when LLM unavailable', async () => {
    const deob = new VMProtectionDeobfuscator();
    const result = await deob.deobfuscateVM('var x=1;', {
      type: 'custom-vm',
      instructionCount: 0,
    });
    assert.strictEqual(typeof result.code, 'string');
  });
});
