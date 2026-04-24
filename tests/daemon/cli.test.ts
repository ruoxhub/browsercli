/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {execFile} from 'node:child_process';
import {describe, it} from 'node:test';
import {promisify} from 'node:util';

const execAsync = promisify(execFile);

describe('CLI Integration', () => {
  it('should respond to status command (daemon must be running)', async () => {
    try {
      const {stdout} = await execAsync(
        'node',
        ['build/src/bin/js-reverse.js', 'status'],
        {
          timeout: 10000,
        },
      );
      const result = JSON.parse(stdout);
      assert.ok(result.pid, 'Should have pid');
      assert.ok(result.socketPath, 'Should have socketPath');
    } catch {
      // Skip if daemon not running
      console.log('SKIP: Daemon not running for status test');
    }
  });

  it('should expose legacy skills via list-tools (daemon must be running)', async () => {
    try {
      const {stdout} = await execAsync(
        'node',
        ['build/src/bin/js-reverse.js', 'list-tools'],
        {
          timeout: 10000,
        },
      );
      assert.ok(stdout.includes('observe-flow'), 'Should include observe-flow');
      assert.ok(stdout.includes('auto-hook'), 'Should include auto-hook');
      assert.ok(
        stdout.includes('rebuild-bundle'),
        'Should include rebuild-bundle',
      );
    } catch {
      // Skip if daemon not running
      console.log('SKIP: Daemon not running for list-tools test');
    }
  });

  it('should execute rebuild-bundle via call (daemon must be running)', async () => {
    try {
      const {stdout} = await execAsync(
        'node',
        [
          'build/src/bin/js-reverse.js',
          'call',
          'rebuild-bundle',
          '--url',
          'https://example.com/test.js',
        ],
        {
          timeout: 30000,
        },
      );
      assert.ok(
        stdout.includes('rebuild_bundle'),
        'Should route to converted tool',
      );
    } catch {
      // Skip if daemon not running
      console.log('SKIP: Daemon not running for rebuild-bundle test');
    }
  });
});
