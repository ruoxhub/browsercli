/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {AdvancedDeobfuscator} from '../../../src/modules/deobfuscator/AdvancedDeobfuscator.js';
import type {
  AdvancedDeobfuscateOptions,
  AdvancedDeobfuscateResult,
} from '../../../src/modules/deobfuscator/AdvancedDeobfuscator.js';
import {
  applyASTOptimizations,
  estimateCodeComplexity,
  normalizeCode,
} from '../../../src/modules/deobfuscator/astUtils.js';

interface LLMServiceLike {
  chat(messages: unknown[]): Promise<{content: string} | string>;
}

interface AdvancedDeobfuscatorTestHarness {
  extractCodeFromLLMResponse(response: string): string;
  isValidJavaScript(code: string): boolean;
  calculateConfidence(
    techniques: string[],
    warnings: string[],
    code: string,
  ): number;
  llmCleanup(code: string, techniques: string[]): Promise<string | null>;
  deobfuscate(
    options: AdvancedDeobfuscateOptions,
  ): Promise<AdvancedDeobfuscateResult>;
}

describe('AdvancedDeobfuscator', () => {
  it('covers code extraction/validation helpers on the facade', () => {
    const d =
      new AdvancedDeobfuscator() as unknown as AdvancedDeobfuscatorTestHarness;
    const extracted = d.extractCodeFromLLMResponse(
      '```javascript\nconst x = 1;\n```',
    );
    assert.strictEqual(extracted, 'const x = 1;');

    assert.strictEqual(d.isValidJavaScript('const a = 1;'), true);
    assert.strictEqual(d.isValidJavaScript('const a = ;'), false);
  });

  it('covers astUtils normalize/complexity/optimization', () => {
    const normalized = normalizeCode(
      '/*a*/ const x = 1; // c\n\n const y = 2;',
    );
    assert.ok(normalized.includes('const'));

    const complexity = estimateCodeComplexity(
      'if(a){for(let i=0;i<2;i++){while(b){break;}}}',
    );
    assert.ok(complexity > 0);

    const optimized = applyASTOptimizations(
      'const a=(1+2); const b=true&&x; false||y;',
    );
    assert.ok(optimized.includes('3'));
    assert.ok(optimized.includes('x'));
  });

  it('covers confidence calculation', () => {
    const d =
      new AdvancedDeobfuscator() as unknown as AdvancedDeobfuscatorTestHarness;
    const c1 = d.calculateConfidence(
      ['vm-protection', 'ast-optimized'],
      ['warn'],
      'const a=1;',
    );
    const c2 = d.calculateConfidence(
      [],
      ['w1', 'w2', 'w3'],
      'function a(){if(x){while(y){}}}',
    );
    assert.ok(c1 >= 0.1 && c1 <= 0.95);
    assert.ok(c2 >= 0.1 && c2 <= 0.95);
  });

  it('covers llm cleanup path and full deobfuscate path', async () => {
    const llm = {
      chat: async () => ({content: '```javascript\nconst cleaned = 1;\n```'}),
    } satisfies LLMServiceLike;
    const d = new AdvancedDeobfuscator(
      llm as unknown as ConstructorParameters<typeof AdvancedDeobfuscator>[0],
    ) as unknown as AdvancedDeobfuscatorTestHarness;

    const cleaned = await d.llmCleanup('const a=1;', ['string-encoding']);
    assert.strictEqual(cleaned, 'const cleaned = 1;');

    const result = await d.deobfuscate({
      code: '\\x61\\u0062;if(false){x()}',
      aggressiveVM: false,
      useASTOptimization: true,
    });
    assert.strictEqual(typeof result.code, 'string');
    assert.ok(Array.isArray(result.detectedTechniques));
    assert.ok(result.confidence > 0);
  });
});
