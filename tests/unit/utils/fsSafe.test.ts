/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {validateOutputPath} from '../../../src/utils/fsSafe.js';

test('validateOutputPath permits paths within allowed output dir', () => {
  const resolved = validateOutputPath('sub/dir/output.json');
  assert.equal(resolved, path.resolve('sub/dir/output.json'));
});

test('validateOutputPath rejects directory traversal escaping base', () => {
  assert.throws(() => validateOutputPath('../../etc/passwd'), {
    message: /Path traversal blocked/,
  });
});
