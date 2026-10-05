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
      assert.ok(result.includes('call'));
      assert.ok(result.includes('list-tools'));
      assert.ok(result.includes('browser'));
      assert.ok(result.includes('jobs'));
      assert.ok(result.includes('config'));
      assert.ok(result.includes('scaffold'));
      assert.ok(result.includes('status'));
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

    it('returns help for browser control with detailed connect options', () => {
      const result = generateCommandHelp('browser');
      assert.ok(result);
      assert.ok(result.includes('browser connect'));
      assert.ok(result.includes('--browser-url'));
      assert.ok(result.includes('--ws-endpoint'));
      assert.ok(result.includes('--channel'));
      assert.ok(result.includes('--executable-path'));
      assert.ok(result.includes('--cloak'));
      assert.ok(result.includes('--headless'));
      assert.ok(result.includes('browser disconnect [--force] [--json]'));
      assert.ok(result.includes('browser status'));
    });

    it('returns dedicated help for browser connect subcommand', () => {
      const result = generateCommandHelp('browser', 'connect');
      assert.ok(result);
      assert.ok(result.includes('Usage: browsercli browser connect'));
      assert.ok(!result.includes('browser disconnect'));
      assert.ok(result.includes('--browser-url <url>'));
      assert.ok(result.includes('--ws-endpoint <url>'));
      assert.ok(result.includes('--channel <name>'));
      assert.ok(result.includes('--executable-path <path>'));
      assert.ok(result.includes('--user-data-dir <dir>'));
      assert.ok(result.includes('--viewport <width>x<height>'));
      assert.ok(result.includes('--cloak'));
      assert.ok(result.includes('--minimal-stealth'));
      assert.ok(result.includes('--full-stealth-args'));
      assert.ok(result.includes('--js-stealth'));
      assert.ok(result.includes('--force'));
    });

    it('returns dedicated help for browser disconnect and status subcommands', () => {
      const disconnect = generateCommandHelp('browser', [
        'disconnect',
        '--help',
      ]);
      assert.ok(disconnect);
      assert.ok(
        disconnect.includes(
          'Usage: browsercli browser disconnect [--force] [--json]',
        ),
      );
      assert.ok(disconnect.includes('--force'));

      const status = generateCommandHelp('browser', ['status']);
      assert.ok(status);
      assert.ok(status.includes('Usage: browsercli browser status [--json]'));
      assert.ok(status.includes('--json'));
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

    it('returns help for status command', () => {
      const result = generateCommandHelp('status');
      assert.ok(result);
      assert.ok(result!.includes('status'));
    });

    it('returns null for removed commands', () => {
      assert.strictEqual(generateCommandHelp('web'), null);
      assert.strictEqual(generateCommandHelp('start'), null);
      assert.strictEqual(generateCommandHelp('stop'), null);
      assert.strictEqual(generateCommandHelp('repl'), null);
    });

    it('returns null for unknown command', () => {
      assert.strictEqual(generateCommandHelp('nonexistent'), null);
    });

    it('returns help for all kept commands', () => {
      const commands = [
        'call',
        'list-tools',
        'browser',
        'jobs',
        'config',
        'scaffold',
        'status',
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
