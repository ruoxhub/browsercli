/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  analyzeJsvmpVm,
  analyzeJsvmpVmCode,
} from '../../../../src/tools/jsvmp/analyzeVm.js';
import type {Response} from '../../../../src/tools/ToolDefinition.js';

interface StructuredResult {
  success: boolean;
  message: string;
  tooltype: string;
  data?: unknown;
}

interface AnalysisData {
  isJsvmp: boolean;
  confidence: number;
  dispatcher?: {
    kind: string;
    switchCount: number;
    maxSwitchCases: number;
    whileTrueCount: number;
    dispatchExpression?: string;
    dispatcherLine?: number;
  };
  bytecode?: {
    kind: string;
    length?: number;
    encrypted: boolean;
    line?: number;
  };
  instructionTable?: {
    kind: string;
    length: number;
    holes: number;
    line?: number;
  };
  opcodes: Array<{id: number | string; type: string; line?: number}>;
  nextSteps: string[];
}

// 最小可用的 while(true)+switch 分派 JSVMP（非真实框架，仅触发静态特征）
const SAMPLE_WHILE_SWITCH = `
var Codes = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
function dispatch(B, Codes) {
  var PC = 0;
  while (true) {
    switch (Codes[PC++]) {
      case 0: B[0](); break;
      case 1: B[Codes[PC++]](); break;
      default: return;
    }
  }
}
`;

// 指令表函数数组（含空洞）+ parseInt 字节码拼接
const SAMPLE_TABLE = `
var Instr = [
  function(a){ return a + 1; },
  ,
  function(a){ return a * 2; },
  function(a){ return a ^ 3; },
];
function decodeBytecode(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i += 2) {
    out.push(parseInt("" + arr[i] + arr[i + 1], 16));
  }
  return out;
}
`;

// IIFE 解密产出字节码数组 + 分派循环（完整 VM）
const SAMPLE_IIFE = `
var Codes = (function () {
  var raw = [10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220];
  var out = [];
  for (var i = 0; i < raw.length; i++) { out.push(raw[i] ^ 0x5a); }
  return out;
})();
function run(B) {
  var PC = 0;
  while (true) {
    switch (Codes[PC++]) {
      case 0: B[Codes[PC++]](); break;
      default: return;
    }
  }
}
`;

// 非 JSVMP：普通业务代码
const SAMPLE_PLAIN = `
function add(a, b) { return a + b; }
function greeting(name) { return 'hello ' + name; }
const total = [1, 2, 3].reduce(add, 0);
`;

function responseHarness() {
  let content: StructuredResult | undefined;
  return {
    response: {
      setStructuredContent(value: StructuredResult) {
        content = value;
      },
    } as unknown as Response,
    get content(): StructuredResult {
      assert.ok(content);
      return content;
    },
  };
}

describe('analyzeJsvmpVmCode (static analysis)', () => {
  it('detects while(true) + switch dispatcher', () => {
    const result = analyzeJsvmpVmCode(SAMPLE_WHILE_SWITCH);
    assert.equal(result.isJsvmp, true);
    assert.equal(result.dispatcher?.kind, 'while-switch');
    assert.equal(result.dispatcher?.whileTrueCount >= 1, true);
    assert.ok(result.dispatcher?.dispatchExpression);
  });

  it('detects bytecode array with holes in instruction table', () => {
    const result = analyzeJsvmpVmCode(SAMPLE_TABLE);
    assert.equal(result.isJsvmp, true);
    assert.equal(result.instructionTable?.kind, 'array-literal');
    assert.equal(result.instructionTable?.length, 4);
    assert.equal(result.instructionTable?.holes, 1);
    assert.equal(result.bytecode?.encrypted, true);
    assert.ok(result.opcodes.length > 0);
  });

  it('detects IIFE-decrypted bytecode as encrypted', () => {
    const result = analyzeJsvmpVmCode(SAMPLE_IIFE);
    assert.equal(result.isJsvmp, true);
    assert.equal(result.bytecode?.kind, 'iife');
    assert.equal(result.bytecode?.encrypted, true);
    assert.equal(result.bytecode?.length, 22);
  });

  it('returns isJsvmp=false for plain code', () => {
    const result = analyzeJsvmpVmCode(SAMPLE_PLAIN);
    assert.equal(result.isJsvmp, false);
    assert.equal(result.confidence, 0);
    assert.equal(result.dispatcher, undefined);
  });

  it('tolerates unparseable input', () => {
    const result = analyzeJsvmpVmCode('function {{{{');
    assert.equal(result.isJsvmp, false);
    assert.ok(result.nextSteps.length > 0);
  });

  it('classifies switch-case opcodes when no instruction table', () => {
    const code = `
var B = [];
var PC = 0;
while (true) {
  switch (Codes[PC++]) {
    case 0: stack.push(a + b); break;
    case 1: stack.pop(); break;
    case 2: if (x) { PC = Codes[PC]; } break;
    case 3: return;
    default: return;
  }
}
`;
    const result = analyzeJsvmpVmCode(code);
    // 无指令表/字节码时按 switch case 分类 opcode
    assert.ok(result.opcodes.length >= 4);
    assert.ok(
      result.opcodes.some(
        op => op.type === 'arithmetic' || op.type === 'control',
      ),
    );
  });
});

describe('analyze_jsvmp_vm tool', () => {
  it('requires code or scriptId', async () => {
    const harness = responseHarness();
    const context = {
      getSelectedFrame: () => {
        throw new Error('no frame');
      },
    } as never;

    await analyzeJsvmpVm.handler({params: {}}, harness.response, context);

    assert.equal(harness.content.success, false);
    assert.match(harness.content.message, /code 或 scriptId/);
  });

  it('analyzes inline code and returns structured data', async () => {
    const harness = responseHarness();
    const context = {
      getSelectedFrame: () => {
        throw new Error('no frame');
      },
    } as never;

    await analyzeJsvmpVm.handler(
      {params: {code: SAMPLE_WHILE_SWITCH}},
      harness.response,
      context,
    );

    assert.equal(harness.content.success, true);
    const data = harness.content.data as AnalysisData;
    assert.equal(data.isJsvmp, true);
    assert.equal(data.confidence >= 0.6, true);
    assert.ok(data.nextSteps.length > 0);
  });
});
