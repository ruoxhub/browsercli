/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {unwrapBabelDefault} from '../../../src/utils/babelUtils.js';

describe('unwrapBabelDefault', () => {
  it('unwraps a nested default object (mod.default.default)', () => {
    const innermost = {marker: true};
    assert.equal(unwrapBabelDefault({default: {default: innermost}}), innermost);
  });

  it('unwraps a single default property', () => {
    const inner = () => 'ok';
    assert.equal(unwrapBabelDefault({default: inner}), inner);
  });

  it('unwraps a callable export whose default is itself callable', () => {
    const traverse = () => 'traverse';
    const mod = {default: {default: traverse}};
    assert.equal(unwrapBabelDefault(mod), traverse);
  });

  it('returns the module unchanged when it has no default', () => {
    const mod = {named: 1};
    assert.equal(unwrapBabelDefault(mod), mod);
  });

  it('returns primitives and null unchanged', () => {
    assert.equal(unwrapBabelDefault('raw'), 'raw');
    assert.equal(unwrapBabelDefault(null), null);
  });
});
