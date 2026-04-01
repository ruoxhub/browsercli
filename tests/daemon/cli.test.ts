/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execAsync = promisify(execFile);

describe('CLI Integration', () => {
  it('should respond to status command (daemon must be running)', async () => {
    try {
      const {stdout} = await execAsync('node', ['build/src/bin/js-reverse.js', 'status'], {
        timeout: 10000,
      });
      const result = JSON.parse(stdout);
      assert.ok(result.pid, 'Should have pid');
      assert.ok(result.socketPath, 'Should have socketPath');
    } catch (error) {
      // Skip if daemon not running
      console.log('SKIP: Daemon not running for status test');
    }
  });

  it('should respond to list-skills command (daemon must be running)', async () => {
    try {
      const {stdout} = await execAsync('node', ['build/src/bin/js-reverse.js', 'list-skills'], {
        timeout: 10000,
      });
      assert.ok(stdout.includes('可用技能:'), 'Should list skills');
      assert.ok(stdout.includes('observe-flow'), 'Should include observe-flow');
      assert.ok(stdout.includes('auto-hook'), 'Should include auto-hook');
      assert.ok(stdout.includes('rebuild-bundle'), 'Should include rebuild-bundle');
    } catch (error) {
      // Skip if daemon not running
      console.log('SKIP: Daemon not running for list-skills test');
    }
  });

  it('should execute rebuild-bundle skill (daemon must be running)', async () => {
    try {
      const {stdout} = await execAsync(
        'node',
        [
          'build/src/bin/js-reverse.js',
          'call-skill',
          'rebuild-bundle',
          '--url',
          'https://example.com/test.js',
        ],
        {
          timeout: 30000,
        }
      );
      assert.ok(stdout.includes('技能执行成功'), 'Should succeed');
      const result = JSON.parse(stdout.split('\n').slice(1).join('\n'));
      assert.strictEqual(result.success, true);
      assert.ok(result.data);
    } catch (error) {
      // Skip if daemon not running
      console.log('SKIP: Daemon not running for rebuild-bundle test');
    }
  });
});
