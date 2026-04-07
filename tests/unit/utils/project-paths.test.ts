/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  resolveDefaultCodeCacheDir,
  resolveDefaultDebuggerSessionsDir,
  resolveDefaultEnvPath,
} from '../../../src/utils/projectPaths.js';

describe('project path resolution', () => {
  it('resolves runtime default paths from the package root instead of process cwd', () => {
    const originalCwd = process.cwd;
    const fakeCwd = path.join(path.parse(process.cwd()).root, 'Windows', 'system32');

    process.cwd = () => fakeCwd;

    try {
      const codeCacheDir = resolveDefaultCodeCacheDir(import.meta.url);
      const debuggerSessionsDir = resolveDefaultDebuggerSessionsDir(import.meta.url);
      const envPath = resolveDefaultEnvPath(import.meta.url);

      assert.ok(codeCacheDir.endsWith(path.join('.cache', 'code')));
      assert.ok(debuggerSessionsDir.endsWith('debugger-sessions'));
      assert.ok(envPath.endsWith('.env'));

      assert.ok(!codeCacheDir.startsWith(fakeCwd));
      assert.ok(!debuggerSessionsDir.startsWith(fakeCwd));
      assert.ok(!envPath.startsWith(fakeCwd));
    } finally {
      process.cwd = originalCwd;
    }
  });
});
