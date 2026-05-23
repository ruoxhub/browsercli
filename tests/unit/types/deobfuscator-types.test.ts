/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {
  DeobfuscateOptions,
  DeobfuscateResult,
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateSavedArtifact,
  ObfuscationType,
} from '../../../src/types/index.js';

describe('Deobfuscator type contract', () => {
  it('DeobfuscateOptions accepts webcrack-related fields', () => {
    const opts: DeobfuscateOptions = {
      code: 'var a=1;',
      webcrack: true,
      unpack: true,
      unminify: false,
      jsx: true,
      mangle: false,
      outputDir: 'tmp/out',
      forceOutput: false,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [{path: 'x.js', pattern: 'foo'}],
    };
    assert.equal(opts.code, 'var a=1;');
  });

  it('DeobfuscateResult exposes engine and bundle fields', () => {
    const result: DeobfuscateResult = {
      code: '',
      readabilityScore: 0,
      confidence: 0,
      obfuscationType: ['webcrack'],
      transformations: [],
      analysis: '',
      engine: 'webcrack',
      webcrackApplied: true,
      cached: false,
      savedTo: 'out',
      bundle: {
        type: 'webpack',
        entryId: '0',
        moduleCount: 1,
        truncated: false,
        modules: [],
      },
      savedArtifacts: [],
    };
    assert.equal(result.engine, 'webcrack');
  });

  it('ObfuscationType union includes webcrack-derived tags', () => {
    const tags: ObfuscationType[] = [
      'webcrack',
      'bundle-unpack',
      'unminify',
      'jsx-decompile',
      'mangle',
    ];
    assert.equal(tags.length, 5);
  });

  it('DeobfuscateMappingRule allows optional matchType and target', () => {
    const rule: DeobfuscateMappingRule = {
      path: 'src/foo.js',
      pattern: 'helper',
      matchType: 'regex',
      target: 'code',
    };
    assert.equal(rule.path, 'src/foo.js');
  });

  it('DeobfuscateSavedArtifact has size and type fields', () => {
    const a: DeobfuscateSavedArtifact = {path: 'a.js', size: 10, type: 'file'};
    assert.equal(a.type, 'file');
  });

  it('DeobfuscateBundleSummary supports optional mappingsApplied', () => {
    const b: DeobfuscateBundleSummary = {
      type: 'browserify',
      entryId: '1',
      moduleCount: 2,
      truncated: true,
      mappingsApplied: 1,
      modules: [
        {
          id: '1',
          path: 'a.js',
          isEntry: true,
          size: 100,
          mappedPathFrom: 'old.js',
        },
      ],
    };
    assert.equal(b.modules[0].mappedPathFrom, 'old.js');
  });
});
