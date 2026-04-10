/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {AdaptiveDataSerializer} from '../../../src/utils/AdaptiveDataSerializer.js';

describe('AdaptiveDataSerializer', () => {
  it('handles objects with null hasOwnProperty', () => {
    const serializer = new AdaptiveDataSerializer();
    // Malicious object that would crash obj.hasOwnProperty() calls
    const malicious = {
      hasOwnProperty: null,
      realKey: 'value',
    };
    // Should not throw
    const result = serializer.serialize(malicious, {});
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('realKey'));
  });

  it('serializes normal objects correctly', () => {
    const serializer = new AdaptiveDataSerializer();
    const data = {a: 1, b: {c: 2}};
    const result = serializer.serialize(data, {});
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('a'));
    assert.ok(result.includes('b'));
  });

  it('limits depth for nested objects', () => {
    const serializer = new AdaptiveDataSerializer();
    const deep = {l1: {l2: {l3: {l4: {l5: 'deep'}}}}};
    const result = serializer.serialize(deep, {maxDepth: 3});
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('[Max depth reached]'));
  });
});
