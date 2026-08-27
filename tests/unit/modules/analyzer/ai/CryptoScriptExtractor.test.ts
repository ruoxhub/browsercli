/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  CryptoScriptExtractor,
  sliceSourceContext,
} from '../../../../../src/modules/analyzer/ai/CryptoScriptExtractor.js';
import type {HookRecordRow} from '../../../../../src/modules/session/types.js';

function createMockHook(overrides: Partial<HookRecordRow> = {}): HookRecordRow {
  return {
    sessionId: 'session-1',
    timestamp: 1700000000000,
    hookType: 'crypto',
    functionName: 'CryptoJS.AES.encrypt',
    arguments: '["secret","key123"]',
    result: '"encrypted-bytes"',
    callStack: null,
    ...overrides,
  };
}

function buildSource(totalLines: number): string {
  return Array.from({length: totalLines}, (_, i) => `line${i + 1}`).join('\n');
}

describe('CryptoScriptExtractor', () => {
  const extractor = new CryptoScriptExtractor();

  it('parses a named V8 stack frame into file/line/column/functionName', () => {
    const hook = createMockHook({
      functionName: 'CryptoJS.AES.encrypt',
      callStack: [
        'Error',
        '    at CryptoJS.AES.encrypt (https://example.com/app.js:42:15)',
        '    at Object.sign (https://example.com/sig.js:10:2)',
      ].join('\n'),
    });

    const snippets = extractor.extractSnippets([hook]);

    assert.strictEqual(snippets.length, 1);
    assert.strictEqual(snippets[0].hookType, 'crypto');
    assert.strictEqual(snippets[0].functionName, 'CryptoJS.AES.encrypt');
    assert.strictEqual(snippets[0].file, 'https://example.com/app.js');
    assert.strictEqual(snippets[0].line, 42);
    assert.strictEqual(snippets[0].column, 15);
  });

  it('falls back to hook.functionName for anonymous frames', () => {
    const hook = createMockHook({
      functionName: 'subtle.encrypt',
      callStack: ['Error', '    at https://example.com/crypto.js:7:3'].join(
        '\n',
      ),
    });

    const snippets = extractor.extractSnippets([hook]);

    assert.strictEqual(snippets.length, 1);
    assert.strictEqual(snippets[0].functionName, 'subtle.encrypt');
    assert.strictEqual(snippets[0].file, 'https://example.com/crypto.js');
    assert.strictEqual(snippets[0].line, 7);
    assert.strictEqual(snippets[0].column, 3);
  });

  it('picks the first frame referencing a .js file URL', () => {
    const hook = createMockHook({
      functionName: 'CryptoJS.SHA256',
      callStack: [
        'Error',
        '    at Array.forEach (<anonymous>)',
        '    at hash (https://cdn.example.com/scripts/hash.js:88:9)',
        '    at https://cdn.example.com/scripts/hash.js:90:1',
      ].join('\n'),
    });

    const snippets = extractor.extractSnippets([hook]);

    assert.strictEqual(snippets.length, 1);
    assert.strictEqual(snippets[0].functionName, 'hash');
    assert.strictEqual(
      snippets[0].file,
      'https://cdn.example.com/scripts/hash.js',
    );
    assert.strictEqual(snippets[0].line, 88);
    assert.strictEqual(snippets[0].column, 9);
  });

  it('de-duplicates snippets by file:line:column', () => {
    const sharedStack = [
      'Error',
      '    at CryptoJS.AES.encrypt (https://example.com/app.js:42:15)',
    ].join('\n');

    const hookA = createMockHook({callStack: sharedStack});
    const hookB = createMockHook({
      callStack: sharedStack,
      result: '"another-result"',
    });
    const hookC = createMockHook({
      callStack:
        'Error\n    at CryptoJS.AES.encrypt (https://example.com/app.js:50:1)',
    });

    const snippets = extractor.extractSnippets([hookA, hookB, hookC]);

    assert.strictEqual(snippets.length, 2);
  });

  it('populates args/result previews', () => {
    const hook = createMockHook({
      arguments: '["secret","key123"]',
      result: '"encrypted-bytes"',
      callStack: 'Error\n    at f (https://example.com/app.js:10:1)',
    });

    const snippets = extractor.extractSnippets([hook]);

    assert.strictEqual(snippets[0].argsPreview, '["secret","key123"]');
    assert.strictEqual(snippets[0].resultPreview, '"encrypted-bytes"');
  });

  it('uses [source unavailable] when no scriptGetter is provided', () => {
    const hook = createMockHook({
      callStack: 'Error\n    at f (https://example.com/app.js:10:1)',
    });

    const snippets = extractor.extractSnippets([hook]);

    assert.strictEqual(snippets[0].sourceSnippet, '[source unavailable]');
    assert.strictEqual(snippets[0].argsPreview, '["secret","key123"]');
    assert.strictEqual(snippets[0].resultPreview, '"encrypted-bytes"');
  });

  it('uses [source unavailable] when scriptGetter returns null', () => {
    const hook = createMockHook({
      callStack: 'Error\n    at f (https://example.com/app.js:10:1)',
    });

    const snippets = extractor.extractSnippets([hook], () => null);

    assert.strictEqual(snippets[0].sourceSnippet, '[source unavailable]');
  });

  it('slices source context from scriptGetter with line-number prefix', () => {
    const source = buildSource(50);
    const hook = createMockHook({
      callStack: 'Error\n    at f (https://example.com/app.js:42:15)',
    });

    const snippets = extractor.extractSnippets([hook], url =>
      url === 'https://example.com/app.js' ? source : null,
    );

    assert.strictEqual(snippets.length, 1);
    assert.ok(snippets[0].sourceSnippet.startsWith('   32 | line32'));
    assert.ok(snippets[0].sourceSnippet.includes('   42 | line42'));
    assert.ok(snippets[0].sourceSnippet.endsWith('   50 | line50'));
  });
});

describe('sliceSourceContext', () => {
  const source = buildSource(50);

  it('prefixes each line with its line number and respects bounds', () => {
    const result = sliceSourceContext(source, 42, 10);
    const lines = result.split('\n');

    assert.strictEqual(lines[0], '   32 | line32');
    assert.strictEqual(lines[lines.length - 1], '   50 | line50');
    assert.ok(lines.includes('   42 | line42'));
  });

  it('clamps the start bound to line 1', () => {
    const result = sliceSourceContext(source, 3, 10);
    const lines = result.split('\n');

    assert.strictEqual(lines[0], '    1 | line1');
    assert.strictEqual(lines.length, 13);
  });

  it('returns empty string when line is out of range', () => {
    assert.strictEqual(sliceSourceContext(source, 999), '');
    assert.strictEqual(sliceSourceContext(source, 0), '');
    assert.strictEqual(sliceSourceContext(source, -5), '');
  });

  it('returns empty string when source is missing', () => {
    assert.strictEqual(sliceSourceContext(null, 10), '');
    assert.strictEqual(sliceSourceContext(undefined, 10), '');
    assert.strictEqual(sliceSourceContext('', 10), '');
  });
});
