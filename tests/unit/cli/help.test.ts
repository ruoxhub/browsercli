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
      const parsed = JSON.parse(result);
      assert.strictEqual(parsed.bin, 'js-reverse');
      assert.ok(parsed.description.includes('JS逆向工程MCP服务'));
      assert.strictEqual(parsed.version, '2.0.3');
      assert.deepStrictEqual(parsed.commands, [
        'start',
        'stop',
        'status',
        'call',
        'call-skill',
        'list-skills',
        'list-tools',
        'repl',
        'scaffold',
      ]);
    });

    it('accepts custom bin name', () => {
      const result = generateTopLevelHelp({bin: 'my-cli'});
      const parsed = JSON.parse(result);
      assert.strictEqual(parsed.bin, 'my-cli');
    });

    it('accepts custom description', () => {
      const result = generateTopLevelHelp({description: 'Custom desc'});
      const parsed = JSON.parse(result);
      assert.strictEqual(parsed.description, 'Custom desc');
    });

    it('accepts custom version', () => {
      const result = generateTopLevelHelp({version: '1.0.0'});
      const parsed = JSON.parse(result);
      assert.strictEqual(parsed.version, '1.0.0');
    });

    it('accepts custom commands list', () => {
      const result = generateTopLevelHelp({commands: ['foo', 'bar']});
      const parsed = JSON.parse(result);
      assert.deepStrictEqual(parsed.commands, ['foo', 'bar']);
    });

    it('returns valid JSON string', () => {
      const result = generateTopLevelHelp();
      assert.doesNotThrow(() => JSON.parse(result));
    });

    it('includes all required fields in output', () => {
      const result = generateTopLevelHelp();
      const parsed = JSON.parse(result);
      assert.ok('bin' in parsed);
      assert.ok('description' in parsed);
      assert.ok('version' in parsed);
      assert.ok('commands' in parsed);
    });
  });

  describe('generateCommandHelp', () => {
    it('returns help for start command', () => {
      const result = generateCommandHelp('start');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'start');
      assert.ok(parsed.description.includes('daemon'));
      assert.ok(parsed.usage.includes('--browserUrl'));
    });

    it('returns help for stop command', () => {
      const result = generateCommandHelp('stop');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'stop');
      assert.ok(parsed.description.includes('停止'));
    });

    it('returns help for status command', () => {
      const result = generateCommandHelp('status');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'status');
    });

    it('returns help for call command', () => {
      const result = generateCommandHelp('call');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'call');
      assert.ok(parsed.usage.includes('<tool-name>'));
    });

    it('returns help for call-skill command', () => {
      const result = generateCommandHelp('call-skill');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'call-skill');
      assert.ok(parsed.usage.includes('<skill-name>'));
    });

    it('returns help for list-skills command', () => {
      const result = generateCommandHelp('list-skills');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'list-skills');
      assert.ok(parsed.usage.includes('--json'));
    });

    it('returns help for list-tools command', () => {
      const result = generateCommandHelp('list-tools');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'list-tools');
    });

    it('returns help for repl command', () => {
      const result = generateCommandHelp('repl');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'repl');
      assert.ok(parsed.description.includes('REPL'));
    });

    it('returns help for scaffold command', () => {
      const result = generateCommandHelp('scaffold');
      assert.ok(result);
      const parsed = JSON.parse(result!);
      assert.strictEqual(parsed.command, 'scaffold');
      assert.ok(parsed.usage.includes('--name'));
    });

    it('returns null for unknown command', () => {
      const result = generateCommandHelp('nonexistent');
      assert.strictEqual(result, null);
    });

    it('returns valid JSON for all known commands', () => {
      const commands = [
        'start',
        'stop',
        'status',
        'call',
        'call-skill',
        'list-skills',
        'list-tools',
        'repl',
        'scaffold',
      ];
      for (const cmd of commands) {
        const result = generateCommandHelp(cmd);
        assert.ok(result, `Expected help for ${cmd}`);
        assert.doesNotThrow(
          () => JSON.parse(result!),
          `Invalid JSON for ${cmd}`,
        );
      }
    });

    it('each command help includes command, description, and usage', () => {
      const commands = [
        'start',
        'stop',
        'status',
        'call',
        'call-skill',
        'list-skills',
        'list-tools',
        'repl',
        'scaffold',
      ];
      for (const cmd of commands) {
        const result = generateCommandHelp(cmd);
        const parsed = JSON.parse(result!);
        assert.strictEqual(parsed.command, cmd);
        assert.ok(typeof parsed.description === 'string');
        assert.ok(typeof parsed.usage === 'string');
      }
    });
  });
});
