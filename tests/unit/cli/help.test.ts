/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  generateCommandHelp,
  generateTopLevelHelp,
} from '../../../src/cli/help.js';

describe('help', () => {
  describe('generateTopLevelHelp', () => {
    it('returns default help with no options', () => {
      const result = generateTopLevelHelp();
      assert.ok(result.includes('browsercli v1.0.0'));
      assert.ok(result.includes('逆向工程CLI服务'));
      assert.ok(result.includes('start'));
      assert.ok(result.includes('stop'));
      assert.ok(result.includes('status'));
      assert.ok(result.includes('call'));
      assert.ok(result.includes('list-tools'));
      assert.ok(result.includes('jobs'));
      assert.ok(result.includes('config'));
      assert.ok(result.includes('scaffold'));
      // 已移除的命令不应在 top level help 中出现
      assert.ok(!result.includes('open'));
      assert.ok(!result.includes('close'));
      assert.ok(!result.includes('list '));
      assert.ok(!result.includes('kill-all'));
      assert.ok(!result.includes('browser '));
    });

    it('accepts custom bin name', () => {
      const result = generateTopLevelHelp({bin: 'my-cli'});
      assert.ok(result.includes('my-cli v1.0.0'));
    });

    it('accepts custom description', () => {
      const result = generateTopLevelHelp({description: 'Custom desc'});
      assert.ok(result.includes('Custom desc'));
    });

    it('accepts custom version', () => {
      const result = generateTopLevelHelp({version: '2.5.0'});
      assert.ok(result.includes('v2.5.0'));
    });

    it('accepts custom commands list', () => {
      const result = generateTopLevelHelp({commands: ['foo', 'bar']});
      assert.ok(result.includes('foo'));
      assert.ok(result.includes('bar'));
    });

    it('includes all required fields in output', () => {
      const result = generateTopLevelHelp();
      assert.ok(result.includes('Commands:'));
      assert.ok(result.includes('Run browsercli <command> --help'));
    });
  });

  describe('generateCommandHelp', () => {
    it('returns help for start command', () => {
      const result = generateCommandHelp('start');
      assert.ok(result);
      assert.ok(result.includes('start'));
      assert.ok(result.includes('--browser-url'));
      assert.ok(result.includes('--channel'));
      assert.ok(result.includes('--headless'));
    });

    it('returns help for stop command', () => {
      const result = generateCommandHelp('stop');
      assert.ok(result);
      assert.ok(result.includes('stop'));
      assert.ok(result.includes('--all'));
    });

    it('returns help for status command', () => {
      const result = generateCommandHelp('status');
      assert.ok(result);
      assert.ok(result.includes('status'));
    });

    it('returns help for call command', () => {
      const result = generateCommandHelp('call');
      assert.ok(result);
      assert.ok(result!.includes('call'));
      assert.ok(result!.includes('<tool-or-skill-name>'));
      assert.ok(result!.includes('--file <script.js>'));
      assert.ok(result!.includes('--stdin'));
    });

    it('returns help for list-tools command', () => {
      const result = generateCommandHelp('list-tools');
      assert.ok(result);
      assert.ok(result!.includes('list-tools'));
    });

    it('returns help for job recovery', () => {
      const result = generateCommandHelp('jobs');
      assert.ok(result);
      assert.ok(result.includes('jobs list'));
      assert.ok(result.includes('jobs cancel <job-id>'));
    });

    it('returns help for config command', () => {
      const result = generateCommandHelp('config');
      assert.ok(result);
      assert.ok(result!.includes('config'));
    });

    it('returns help for scaffold command', () => {
      const result = generateCommandHelp('scaffold');
      assert.ok(result);
      assert.ok(result!.includes('--name'));
    });

    it('returns null for removed commands', () => {
      assert.strictEqual(generateCommandHelp('web'), null);
      assert.strictEqual(generateCommandHelp('repl'), null);
      assert.strictEqual(generateCommandHelp('open'), null);
      assert.strictEqual(generateCommandHelp('close'), null);
      assert.strictEqual(generateCommandHelp('list'), null);
      assert.strictEqual(generateCommandHelp('kill-all'), null);
      assert.strictEqual(generateCommandHelp('browser'), null);
    });

    it('returns null for unknown command', () => {
      assert.strictEqual(generateCommandHelp('nonexistent'), null);
    });

    it('returns help for all kept commands', () => {
      const commands = [
        'start',
        'stop',
        'status',
        'call',
        'list-tools',
        'jobs',
        'config',
        'scaffold',
      ];
      for (const cmd of commands) {
        const result = generateCommandHelp(cmd);
        assert.ok(result, `Expected help for ${cmd}`);
        assert.ok(
          result!.includes(cmd),
          `Expected command name in help for ${cmd}`,
        );
      }
    });
  });
});
