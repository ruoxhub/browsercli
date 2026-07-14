/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  errorMessage,
  getErrorMessage,
} from '../../../../src/tools/shared/pageResponse.js';

describe('errorMessage / getErrorMessage', () => {
  it('Error 实例返回 message', () => {
    assert.equal(errorMessage(new Error('boom')), 'boom');
    assert.equal(getErrorMessage(new Error('boom')), 'boom');
  });

  it('字符串返回原值', () => {
    assert.equal(errorMessage('oops'), 'oops');
    assert.equal(getErrorMessage('oops'), 'oops');
  });

  it('数字/对象返回 String(v)', () => {
    assert.equal(errorMessage(42), '42');
    assert.equal(getErrorMessage({a: 1}), '[object Object]');
  });

  it('null/undefined 返回 "null"/"undefined"', () => {
    assert.equal(errorMessage(null), 'null');
    assert.equal(getErrorMessage(undefined), 'undefined');
  });
});
