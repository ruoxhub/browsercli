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
      assert.ok(result.includes('js-reverse v2.0.3'));
      assert.ok(result.includes('JS逆向工程MCP服务'));
      assert.ok(result.includes('call'));
      assert.ok(result.includes('list-tools'));
      assert.ok(result.includes('call-skill'));
      assert.ok(result.includes('list-skills'));
    });

    it('accepts custom bin name', () => {
      const result = generateTopLevelHelp({bin: 'my-cli'});
      assert.ok(result.includes('my-cli v2.0.3'));
    });

    it('accepts custom description', () => {
      const result = generateTopLevelHelp({description: 'Custom desc'});
      assert.ok(result.includes('Custom desc'));
    });

    it('accepts custom version', () => {
      const result = generateTopLevelHelp({version: '1.0.0'});
      assert.ok(result.includes('v1.0.0'));
    });

    it('accepts custom commands list', () => {
      const result = generateTopLevelHelp({commands: ['foo', 'bar']});
      assert.ok(result.includes('foo'));
      assert.ok(result.includes('bar'));
    });

    it('includes all required fields in output', () => {
      const result = generateTopLevelHelp();
      assert.ok(result.includes('Commands:'));
      assert.ok(result.includes('Run js-reverse <command> --help'));
    });
  });

  describe('generateCommandHelp', () => {
    it('returns help for start command', () => {
      const result = generateCommandHelp('start');
      assert.ok(result);
      assert.ok(result!.includes('start'));
      assert.ok(result!.includes('--browserUrl'));
    });

    it('returns help for stop command', () => {
      const result = generateCommandHelp('stop');
      assert.ok(result);
      assert.ok(result!.includes('stop'));
      assert.ok(result!.includes('停止'));
    });

    it('returns help for status command', () => {
      const result = generateCommandHelp('status');
      assert.ok(result);
      assert.ok(result!.includes('status'));
    });

    it('returns help for call command', () => {
      const result = generateCommandHelp('call');
      assert.ok(result);
      assert.ok(result!.includes('<tool-or-skill-name>'));
      assert.ok(result!.includes('--data'));
    });

    it('returns help for list-tools command', () => {
      const result = generateCommandHelp('list-tools');
      assert.ok(result);
      assert.ok(result!.includes('兼容映射'));
    });

    it('returns help for call-skill command', () => {
      const result = generateCommandHelp('call-skill');
      assert.ok(result);
      assert.ok(result!.includes('<skill-name>'));
      assert.ok(result!.includes('--data'));
    });

    it('returns help for list-skills command', () => {
      const result = generateCommandHelp('list-skills');
      assert.ok(result);
      assert.ok(result!.includes('--json'));
    });

    it('returns help for repl command', () => {
      const result = generateCommandHelp('repl');
      assert.ok(result);
      assert.ok(result!.includes('REPL'));
    });

    it('returns help for scaffold command', () => {
      const result = generateCommandHelp('scaffold');
      assert.ok(result);
      assert.ok(result!.includes('--name'));
    });

    it('returns null for unknown command', () => {
      const result = generateCommandHelp('nonexistent');
      assert.strictEqual(result, null);
    });

    it('returns help for all known commands', () => {
      const commands = [
        'start',
        'stop',
        'status',
        'call',
        'call-skill',
        'list-tools',
        'list-skills',
        'repl',
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

    it('each command help includes command and usage', () => {
      const commands = [
        'start',
        'stop',
        'status',
        'call',
        'call-skill',
        'list-tools',
        'list-skills',
        'repl',
        'scaffold',
      ];
      for (const cmd of commands) {
        const result = generateCommandHelp(cmd);
        assert.ok(result!.includes(cmd));
        assert.ok(result!.includes('用法:'));
      }
    });
  });
});
