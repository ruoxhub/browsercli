/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {execSync} from 'node:child_process';
import {describe, it} from 'node:test';

const CLI_PATH = 'node build/src/bin/js-reverse.js';

/**
 * 执行 CLI 命令并返回输出
 */
function runCli(args: string): string {
  return execSync(`${CLI_PATH} ${args}`, {encoding: 'utf8'});
}

describe('CLI Integration', () => {
  it('shows help with all commands', () => {
    const output = runCli('--help');
    assert.ok(output.includes('start'), 'Should include start command');
    assert.ok(output.includes('stop'), 'Should include stop command');
    assert.ok(output.includes('status'), 'Should include status command');
    assert.ok(output.includes('repl'), 'Should include repl command');
    assert.ok(output.includes('scaffold'), 'Should include scaffold command');
    assert.ok(
      output.includes('call-skill'),
      'Should include call-skill command',
    );
    assert.ok(
      output.includes('list-skills'),
      'Should include list-skills command',
    );
  });

  // 以下测试需要 daemon 环境，临时跳过
  it.skip('status command returns daemon info', () => {
    const output = runCli('status');
    const data = JSON.parse(output);
    assert.ok(typeof data.pid === 'number', 'Should have pid');
    assert.ok(typeof data.socketPath === 'string', 'Should have socketPath');
    assert.ok(typeof data.startDate === 'string', 'Should have startDate');
  });

  it.skip('list-skills returns three skills', () => {
    const output = runCli('list-skills');
    assert.ok(
      output.includes('observe-flow'),
      'Should have observe-flow skill',
    );
    assert.ok(output.includes('auto-hook'), 'Should have auto-hook skill');
    assert.ok(
      output.includes('rebuild-bundle'),
      'Should have rebuild-bundle skill',
    );
  });

  it.skip('call-skill observe-flow executes successfully', () => {
    const output = runCli('call-skill observe-flow --url https://example.com');
    assert.ok(output.includes('技能执行成功'), 'Should execute successfully');
    assert.ok(output.includes('observe-flow'), 'Should mention skill name');
  });

  it.skip('call-skill auto-hook executes successfully', () => {
    const output = runCli('call-skill auto-hook --url https://example.com');
    assert.ok(output.includes('技能执行成功'), 'Should execute successfully');
    assert.ok(output.includes('auto-hook'), 'Should mention skill name');
  });

  it.skip('call-skill rebuild-bundle executes successfully', () => {
    const output = runCli(
      'call-skill rebuild-bundle --url https://example.com',
    );
    assert.ok(output.includes('技能执行成功'), 'Should execute successfully');
    assert.ok(output.includes('rebuild-bundle'), 'Should mention skill name');
    assert.ok(
      output.includes('bundlePath'),
      'Should have bundlePath in response',
    );
  });

  it('scaffold command shows help without args', () => {
    const output = runCli('scaffold --help');
    assert.ok(output.includes('--name'), 'Should have --name option');
    assert.ok(output.includes('--desc'), 'Should have --desc option');
    assert.ok(output.includes('--url'), 'Should have --url option');
    assert.ok(output.includes('--output'), 'Should have --output option');
  });

  it('rejects invalid task names', () => {
    // Test with invalid name (starts with number)
    try {
      runCli(
        'scaffold --name 123invalid --desc test --url https://example.com 2>&1',
      );
      assert.fail('Should reject invalid task name');
    } catch (e: any) {
      // Command exits with code 2 for VALIDATION_ERROR - that's expected behavior
      assert.ok(e.status === 2, `Should exit with code 2, got ${e.status}`);
    }
  });

  it('accepts valid task names', () => {
    // Test with valid name
    const output = runCli(
      'scaffold --name test-task --desc "Test Task" --url https://example.com --output /tmp/test-scaffold',
    );
    assert.ok(
      output.includes('任务脚手架创建成功'),
      'Should create scaffold successfully',
    );
  });

  it('call without tool name exits with code 2', () => {
    try {
      runCli('call 2>&1');
      assert.fail('Should reject missing tool name');
    } catch (e: any) {
      assert.ok(e.status === 2, `Should exit with code 2, got ${e.status}`);
      assert.ok(
        e.stdout.includes('VALIDATION_ERROR'),
        'Should include VALIDATION_ERROR',
      );
    }
  });

  it('call-skill without skill name exits with code 2', () => {
    try {
      runCli('call-skill 2>&1');
      assert.fail('Should reject missing skill name');
    } catch (e: any) {
      assert.ok(e.status === 2, `Should exit with code 2, got ${e.status}`);
      assert.ok(
        e.stdout.includes('VALIDATION_ERROR'),
        'Should include VALIDATION_ERROR',
      );
    }
  });

  it('scaffold without name exits with code 2', () => {
    try {
      runCli('scaffold 2>&1');
      assert.fail('Should reject missing name');
    } catch (e: any) {
      assert.ok(e.status === 2, `Should exit with code 2, got ${e.status}`);
      assert.ok(
        e.stdout.includes('VALIDATION_ERROR'),
        'Should include VALIDATION_ERROR',
      );
    }
  });

  it('call with unknown tool exits with code 1', () => {
    try {
      runCli('call nonexistent-tool-xyz 2>&1');
      assert.fail('Should reject unknown tool');
    } catch (e: any) {
      assert.ok(e.status === 1, `Should exit with code 1, got ${e.status}`);
      assert.ok(
        e.stdout.includes('UNKNOWN_TOOL'),
        'Should include UNKNOWN_TOOL',
      );
    }
  });

  it('call with daemon not running exits with code 1', () => {
    try {
      runCli('call query_dom 2>&1');
      assert.fail('Should fail when daemon not running');
    } catch (e: any) {
      assert.ok(e.status === 1, `Should exit with code 1, got ${e.status}`);
      assert.ok(
        e.stdout.includes('TOOL_INVOCATION_ERROR') ||
          e.stdout.includes('DAEMON_ERROR'),
        'Should include daemon error',
      );
    }
  });

  it('call-skill with daemon not running exits with code 1', () => {
    try {
      runCli('call-skill observe-flow 2>&1');
      assert.fail('Should fail when daemon not running');
    } catch (e: any) {
      assert.ok(e.status === 1, `Should exit with code 1, got ${e.status}`);
      assert.ok(
        e.stdout.includes('DAEMON_ERROR'),
        'Should include DAEMON_ERROR',
      );
    }
  });

  it('stop without daemon exits with code 1', () => {
    try {
      runCli('stop 2>&1');
      assert.fail('Should fail when daemon not running');
    } catch (e: any) {
      assert.ok(e.status === 1, `Should exit with code 1, got ${e.status}`);
      assert.ok(
        e.stdout.includes('DAEMON_NOT_RUNNING'),
        'Should include DAEMON_NOT_RUNNING',
      );
    }
  });

  it('start --help shows --wait-for-browser flag', () => {
    const output = runCli('start --help');
    assert.ok(
      output.includes('--wait-for-browser'),
      'Should include --wait-for-browser in start help',
    );
  });

  it('start --wait-for-browser with no browserUrl does not error', () => {
    // When --wait-for-browser is set but --browserUrl is not, the flag is
    // ignored and start proceeds normally. Since daemon may already be running
    // in the test environment, we just verify the flag is accepted without
    // a VALIDATION_ERROR exit code.
    try {
      runCli('start --wait-for-browser 2>&1');
      // If daemon is already running, exit code 1 is acceptable
    } catch (e: any) {
      // Accept DAEMON_ALREADY_RUNNING (code 1) or DAEMON_ORPHANED (code 1)
      assert.ok(
        e.status === 1,
        `Expected exit 1, got ${e.status}. Flag should be accepted.`,
      );
      assert.ok(
        e.stdout.includes('DAEMON') || e.stdout.includes('already'),
        'Should fail with daemon-related error, not VALIDATION_ERROR',
      );
    }
  });
});
