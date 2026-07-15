/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import JavaScriptObfuscator from 'javascript-obfuscator';

import {
  basicTransform,
  renameVariables,
  simplifyExpressions,
} from '../../../src/modules/deobfuscator/CodeCleanupStrategy.js';
import {unflattenControlFlow} from '../../../src/modules/deobfuscator/ControlFlowStrategy.js';
import {Deobfuscator} from '../../../src/modules/deobfuscator/Deobfuscator.js';
import {
  detectObfuscationType,
  mergeObfuscationTypes,
} from '../../../src/modules/deobfuscator/ObfuscationDetector.js';
import {
  decodeStrings,
  decryptArrays,
  extractStringArrays,
} from '../../../src/modules/deobfuscator/StringDecryptionStrategy.js';
import {
  runAdvanced as runAdvancedDispatch,
  runASTOptimizer as runASTOptimizerDispatch,
  runJSVMP as runJSVMPDispatch,
  runUnpack as runUnpackDispatch,
} from '../../../src/modules/deobfuscator/SubPipelineRunner.js';
import type {Transformation, UnresolvedPart} from '../../../src/types/index.js';

interface DeobfuscatorHarness {
  shouldRun(
    explicitFlag: boolean | undefined,
    autoMode: boolean,
    detected: string[],
    triggers: string[],
  ): boolean;
  calculateConfidence(
    transformations: Array<{success: boolean}>,
    readabilityScore: number,
  ): number;
  calculateReadabilityScore(code: string): number;
  llmAnalysis(code: string): Promise<string | null>;
  runUnpack(code: string, transformations: Transformation[]): Promise<string>;
  runJSVMP(
    code: string,
    options: Record<string, unknown>,
    transformations: Transformation[],
    pipelineWarnings: string[],
    pipelineUnresolved: UnresolvedPart[],
  ): Promise<string>;
  runAdvanced(
    code: string,
    options: Record<string, unknown>,
    transformations: Transformation[],
    pipelineWarnings: string[],
  ): Promise<string>;
  runASTOptimizer(
    code: string,
    transformations: Transformation[],
  ): Promise<string>;
  generateCacheKey(options: Record<string, unknown>): string;
  cacheResult(key: string, result: {code: string}): void;
  clearCache(): void;
  deobfuscate(options: {
    code: string;
    auto?: boolean;
    aggressive?: boolean;
    astOptimize?: boolean;
    renameVariables?: boolean;
    llm?: boolean;
  }): Promise<{
    code: string;
    transformations: Transformation[];
    warnings?: string[];
    unresolvedParts?: UnresolvedPart[];
    cached?: boolean;
  }>;
  universalUnpacker: {
    deobfuscate(
      code: string,
    ): Promise<{success: boolean; code: string; type: string}>;
  };
  jsvmpDeobfuscator: {
    deobfuscate(options: Record<string, unknown>): Promise<{
      isJSVMP: boolean;
      confidence: number;
      vmType?: string;
      warnings?: string[];
      unresolvedParts?: UnresolvedPart[];
      deobfuscatedCode: string;
    }>;
  };
  advancedDeobfuscator: {
    deobfuscate(options: Record<string, unknown>): Promise<{
      code: string;
      warnings?: string[];
      detectedTechniques: string[];
      confidence: number;
    }>;
  };
  astOptimizer: {
    optimize(code: string): string;
  };
  llm?: {
    chat(): Promise<{content: string}>;
  };
  maxCacheSize: number;
  resultCache: Map<string, {code: string}>;
  stringArrays: Map<string, string[]>;
}

describe('Deobfuscator extended', () => {
  it('detects multiple obfuscation signatures', () => {
    const code = `
      var _0xabc=['a'];
      eval(atob("YWJj")); Function("return 1");
      while(!![]){switch(x){case 0:break;}}
      if(false){a()}
      \\x61 \\u0062 __webpack_require__ webpackJsonp
    `;
    const types = detectObfuscationType(code);
    assert.ok(types.includes('javascript-obfuscator'));
    assert.ok(types.includes('vm-protection'));
    assert.ok(types.includes('control-flow-flattening'));
    assert.ok(types.includes('dead-code-injection'));
    assert.ok(types.includes('hex-encoding'));
    assert.ok(types.includes('webpack'));
  });

  it('runs basic transform/decode/extract/decrypt/simplify/rename', async () => {
    const ts: Transformation[] = [];

    const basic = await basicTransform('if(true){a=1+2;} else {a=3;}', ts);
    assert.ok(basic.includes('3'));

    const decoded = await decodeStrings('const s="\\x61\\u0062";', ts);
    assert.ok(decoded.includes('ab'));

    const stringArrays = new Map<string, string[]>();
    await extractStringArrays('var _0x1=["hello","world"];', ts, stringArrays);
    const decrypted = await decryptArrays(
      'console.log(_0x1[1]);',
      ts,
      stringArrays,
    );
    assert.ok(decrypted.includes('"world"'));

    const simplified = await simplifyExpressions(
      'const a=!!x;const b=void 0;const c=!0;',
      ts,
    );
    assert.ok(simplified.includes('undefined'));
    assert.ok(simplified.includes('true'));

    const renamed = await renameVariables(
      'var _0xabc=1;console.log(_0xabc);',
      ts,
    );
    assert.ok(renamed.includes('var_0'));
  });

  it('inlines javascript-obfuscator string decoder wrapper calls', async () => {
    const d = new Deobfuscator() as unknown as DeobfuscatorHarness;
    const result = await d.deobfuscate({
      code: "function _0x5c1a(){const _0x2f8b=['log','Hello, JSReverser-MCP!'];_0x5c1a=function(){return _0x2f8b;};return _0x5c1a();}function _0x1f4d(_0x31f4f6,_0x4df9ff){const _0x5c1af4=_0x5c1a();return _0x1f4d=function(_0x1f4d7d,_0x2dcf8d){_0x1f4d7d=_0x1f4d7d-0x0;return _0x5c1af4[_0x1f4d7d];},_0x1f4d(_0x31f4f6,_0x4df9ff);}console[_0x1f4d(0x0)](_0x1f4d(0x1));",
      aggressive: true,
      renameVariables: true,
    });

    assert.ok(result.code.includes('console.log'));
    assert.ok(result.code.includes('Hello, JSReverser-MCP!'));
    assert.ok(!result.code.includes('_0x1f4d(0x0)'));
  });

  it('evaluates rotated javascript-obfuscator decoder calls from sandbox', async () => {
    const d = new Deobfuscator() as unknown as DeobfuscatorHarness;
    const source = `
      const CONFIG = {
        version: '1.2.3',
        salt: 'mcp-demo-salt',
        api: '/api/demo',
      };

      function buildHeaders(token) {
        return {
          'x-token': token,
          'x-version': CONFIG.version,
        };
      }

      function sign(payload, ts) {
        const base = Object.keys(payload)
          .sort()
          .map(key => key + '=' + String(payload[key]))
          .join('&');
        const raw = base + '|' + ts + '|' + CONFIG.salt;
        return Buffer.from(raw).toString('base64');
      }

      async function submit(payload, token) {
        const ts = 1710000000;
        return {
          url: CONFIG.api,
          headers: buildHeaders(token),
          body: {
            payload,
            ts,
            sign: sign(payload, ts),
          },
        };
      }

      submit({a: 1, b: 'ok'}, 'demo-token').then(console.log);
    `;
    const obfuscated = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 1,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 1,
      stringArray: true,
      stringArrayThreshold: 1,
      stringArrayEncoding: ['base64'],
      stringArrayWrappersCount: 2,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      splitStrings: true,
      splitStringsChunkLength: 4,
      simplify: true,
      transformObjectKeys: true,
      renameGlobals: false,
    }).getObfuscatedCode();

    const result = await d.deobfuscate({
      code: obfuscated,
      aggressive: true,
      renameVariables: true,
    });

    assert.ok(result.code.includes('demo-token'));
    assert.ok(result.code.includes('x-token'));
    assert.ok(result.code.includes('/api/demo'));
    assert.ok(result.code.includes('base64'));
    // The pipeline may resolve strings via various strategy steps
    // (inline-string-decoders, evaluate-string-decoders, decrypt-arrays, etc.)
    // The content assertions above verify the strings were resolved;
    // here we just confirm the pipeline ran string-related transforms.
    const stringTransformTypes = [
      'evaluate-string-decoders',
      'inline-string-decoders',
      'decrypt-arrays',
      'extract-string-arrays',
      'string-decode',
    ];
    assert.ok(
      result.transformations.some(
        transformation =>
          stringTransformTypes.includes(transformation.type) &&
          transformation.success,
      ),
    );
  });

  it('unflattens simple switch/while control flow', async () => {
    const ts: Transformation[] = [];
    const code = `
      var order = "0|1".split("|"), i = 0;
      while(true){
        switch(order[i++]){
          case "0": foo(); continue;
          case "1": bar(); break;
        }
        break;
      }
    `;
    const out = await unflattenControlFlow(code, ts);
    assert.ok(out.includes('foo()') || out.includes('bar()'));
  });

  it('supports shouldRun / merge / scoring helpers', () => {
    const d = new Deobfuscator() as unknown as DeobfuscatorHarness;
    assert.strictEqual(d.shouldRun(true, false, [], []), true);
    assert.strictEqual(d.shouldRun(false, true, ['packer'], ['packer']), false);
    assert.strictEqual(
      d.shouldRun(undefined, true, ['packer'], ['packer']),
      true,
    );

    const merged = mergeObfuscationTypes(
      ['unknown'],
      [
        {
          type: 'unpack',
          description: 'Unpacked Packer obfuscation',
          success: true,
        },
        {
          type: 'advanced',
          description: 'contains control-flow-flattening',
          success: true,
        },
      ],
    );
    assert.ok(merged.includes('packer'));
    assert.ok(merged.includes('control-flow-flattening'));
    assert.ok(!merged.includes('unknown'));

    const confidence = d.calculateConfidence(
      [{success: true}, {success: false}],
      50,
    );
    assert.ok(confidence >= 0 && confidence <= 1);
    const readability = d.calculateReadabilityScore(
      'const abc = 1;\n// comment',
    );
    assert.ok(readability > 0);
  });

  it('handles LLM analysis success and failure', async () => {
    const llmOk = {
      generateDeobfuscationPrompt: (_code: string) => [
        {role: 'user', content: _code},
      ],
      chat: async () => ({content: 'analysis ok'}),
    };
    const d1 = new Deobfuscator(
      llmOk as unknown as ConstructorParameters<typeof Deobfuscator>[0],
    ) as unknown as DeobfuscatorHarness;
    const r1 = await d1.llmAnalysis('code');
    assert.strictEqual(r1, 'analysis ok');

    const llmFail = {
      generateDeobfuscationPrompt: () => [{role: 'user', content: 'x'}],
      chat: async () => {
        throw new Error('llm down');
      },
    };
    const d2 = new Deobfuscator(
      llmFail as unknown as ConstructorParameters<typeof Deobfuscator>[0],
    ) as unknown as DeobfuscatorHarness;
    const r2 = await d2.llmAnalysis('code');
    assert.strictEqual(r2, null);
  });

  it('handles runUnpack/runJSVMP/runAdvanced/runASTOptimizer branches', async () => {
    const ts: Transformation[] = [];
    const warnings: string[] = [];
    const unresolved: UnresolvedPart[] = [];

    const mockUnpacker = {
      deobfuscate: async () => ({
        success: true,
        code: 'unpacked',
        type: 'packer',
      }),
    };
    const unpacked = await runUnpackDispatch(mockUnpacker as any, 'x', ts);
    assert.strictEqual(unpacked, 'unpacked');

    const mockJsvmp = {
      deobfuscate: async () => ({
        isJSVMP: true,
        confidence: 0.8,
        vmType: 'switch',
        warnings: ['w1'],
        unresolvedParts: [{location: 'vm', reason: 'trace-missing'}],
        deobfuscatedCode: 'jsvmp-out',
      }),
    };
    const jsvmp = await runJSVMPDispatch(
      mockJsvmp as any,
      'x',
      {} as any,
      ts,
      warnings,
      unresolved,
    );
    assert.strictEqual(jsvmp, 'jsvmp-out');
    assert.ok(warnings.length > 0);
    assert.ok(unresolved.length > 0);

    const mockAdvanced = {
      deobfuscate: async () => ({
        code: 'advanced-out',
        warnings: ['w2'],
        detectedTechniques: ['invisible-unicode'],
        confidence: 0.7,
      }),
    };
    const adv = await runAdvancedDispatch(
      mockAdvanced as any,
      'x',
      {} as any,
      ts,
      warnings,
    );
    assert.strictEqual(adv, 'advanced-out');

    const mockOptimizer = {
      optimize: (code: string) => `${code}//opt`,
    };
    const opt = await runASTOptimizerDispatch(mockOptimizer as any, 'x', ts);
    assert.ok(opt.includes('//opt'));
  });

  it('builds cache key and evicts old entries', () => {
    const d = new Deobfuscator() as unknown as DeobfuscatorHarness;
    const k1 = d.generateCacheKey({code: 'a', aggressive: false});
    const k2 = d.generateCacheKey({code: 'b', aggressive: false});
    assert.notStrictEqual(k1, k2);

    d.maxCacheSize = 2;
    d.cacheResult('k1', {code: '1'});
    d.cacheResult('k2', {code: '2'});
    d.cacheResult('k3', {code: '3'});
    assert.strictEqual(d.resultCache.has('k1'), false);
    assert.strictEqual(d.resultCache.has('k3'), true);
    d.clearCache();
    assert.strictEqual(d.resultCache.size, 0);
    assert.strictEqual(d.stringArrays.size, 0);
  });

  it('runs full deobfuscate pipeline and returns cached result on second call', async () => {
    const d = new Deobfuscator() as unknown as DeobfuscatorHarness;

    const opts = {
      code: 'const x = 1;',
      auto: false,
      aggressive: false,
      renameVariables: false,
    };

    const r1 = await d.deobfuscate(opts);
    assert.ok(typeof r1.code === 'string');
    assert.ok(Array.isArray(r1.transformations));
    assert.ok(Array.isArray(r1.warnings));

    const r2 = await d.deobfuscate(opts);
    assert.strictEqual((r2 as any).cached, true);
    assert.strictEqual(r2.code, r1.code);
    assert.deepStrictEqual(r2.transformations, r1.transformations);
  });

  it('propagates deobfuscate pipeline fatal error on empty code', async () => {
    const d = new Deobfuscator() as unknown as DeobfuscatorHarness;
    await assert.rejects(async () => {
      await d.deobfuscate({code: ''});
    }, /No code provided/);
  });

  it('covers parser-failure catch branches in helper transforms', async () => {
    const ts: Transformation[] = [];
    const bad = 'const = ;';
    const stringArrays = new Map<string, string[]>();

    const a = await extractStringArrays(bad, ts, stringArrays);
    const b = await decodeStrings(bad, ts);
    const c = await decryptArrays(bad, ts, stringArrays);
    const e = await unflattenControlFlow(bad, ts);
    const f = await simplifyExpressions(bad, ts);
    const g = await renameVariables(bad, ts);

    assert.strictEqual(a, bad);
    assert.strictEqual(b, bad);
    assert.strictEqual(c, bad);
    assert.strictEqual(e, bad);
    assert.strictEqual(f, bad);
    assert.strictEqual(g, bad);
    assert.ok(ts.some(t => t.success === false));
  });
});
