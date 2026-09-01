/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {normalizeHost} from '../../../../src/modules/proxy/hostFilter.js';

describe('normalizeHost', () => {
  it('小写化并去尾点', () => {
    assert.strictEqual(normalizeHost('Example.COM.'), 'example.com');
  });

  it('剥掉 IPv6 方括号', () => {
    assert.strictEqual(normalizeHost('[240c::1]'), '240c::1');
    assert.strictEqual(normalizeHost('[240c::1]:8080'), '240c::1');
  });

  it('去掉端口后缀（不影响 IPv6 冒号）', () => {
    assert.strictEqual(normalizeHost('a.dev:8080'), 'a.dev');
    assert.strictEqual(normalizeHost('240c::1'), '240c::1');
  });

  it('空串保持空串', () => {
    assert.strictEqual(normalizeHost(''), '');
  });
});
