/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {withTimeout} from '../../../src/utils/withTimeout.js';

const delay = (ms: number): Promise<string> =>
  new Promise(resolve => setTimeout(() => resolve('late'), ms));

describe('withTimeout', () => {
  it('passes through a resolved value', async () => {
    assert.strictEqual(await withTimeout(Promise.resolve(7), 100, 'nope'), 7);
  });

  it('propagates the original rejection', async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error('inner')), 100, 'nope'),
      /inner/,
    );
  });

  it('rejects with the given message when the promise never settles', async () => {
    await assert.rejects(withTimeout(delay(50), 5, 'timed out'), /timed out/);
  });

  it('does not reject once the promise settles first', async () => {
    assert.strictEqual(await withTimeout(delay(5), 200, 'timed out'), 'late');
  });
});
