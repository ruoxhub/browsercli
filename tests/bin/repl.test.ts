/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {parseCommand, parseSkillArgs, executeCommand} from '../../src/bin/repl.js';

describe('REPL parseCommand', () => {
  it('parses simple command without args', () => {
    const result = parseCommand('help');
    assert.strictEqual(result.command, 'help');
    assert.deepStrictEqual(result.args, []);
  });

  it('parses command with args', () => {
    const result = parseCommand('skill rebuild-bundle --url https://example.com');
    assert.strictEqual(result.command, 'skill');
    assert.deepStrictEqual(result.args, ['rebuild-bundle', '--url', 'https://example.com']);
  });

  it('handles empty input', () => {
    const result = parseCommand('');
    assert.strictEqual(result.command, '');
    assert.deepStrictEqual(result.args, []);
  });

  it('handles whitespace only input', () => {
    const result = parseCommand('   ');
    assert.strictEqual(result.command, '');
    assert.deepStrictEqual(result.args, []);
  });

  it('converts command to lowercase', () => {
    const result = parseCommand('HELP');
    assert.strictEqual(result.command, 'help');
    assert.deepStrictEqual(result.args, []);
  });

  it('preserves arg case', () => {
    const result = parseCommand('skill MySkill --URL Https://Example.COM');
    assert.strictEqual(result.command, 'skill');
    assert.deepStrictEqual(result.args, ['MySkill', '--URL', 'Https://Example.COM']);
  });
});

describe('REPL parseSkillArgs', () => {
  it('parses url argument', () => {
    const result = parseSkillArgs(['--url', 'https://example.com']);
    assert.strictEqual(result.url, 'https://example.com');
    assert.deepStrictEqual(result.options, {});
  });

  it('parses multiple options', () => {
    const result = parseSkillArgs(['--url', 'https://example.com', '--verbose', '--output', 'file.js']);
    assert.strictEqual(result.url, 'https://example.com');
    assert.deepStrictEqual(result.options, {
      verbose: true,
      output: 'file.js',
    });
  });

  it('handles no arguments', () => {
    const result = parseSkillArgs([]);
    assert.strictEqual(result.url, undefined);
    assert.deepStrictEqual(result.options, {});
  });

  it('handles boolean flags', () => {
    const result = parseSkillArgs(['--verbose', '--dry-run']);
    assert.strictEqual(result.url, undefined);
    assert.deepStrictEqual(result.options, {
      verbose: true,
      'dry-run': true,
    });
  });
});

describe('REPL executeCommand', () => {
  it('returns help text for help command', async () => {
    const result = await executeCommand('help');
    assert.ok(result.includes('JS Reverse MCP - REPL 交互模式'));
    assert.ok(result.includes('help'));
    assert.ok(result.includes('skills'));
  });

  it('returns empty string for empty command', async () => {
    const result = await executeCommand('');
    assert.strictEqual(result, '');
  });

  it('returns exit marker for exit command', async () => {
    const result = await executeCommand('exit');
    assert.strictEqual(result, '__EXIT__');
  });

  it('returns exit marker for quit command', async () => {
    const result = await executeCommand('quit');
    assert.strictEqual(result, '__EXIT__');
  });

  it('returns exit marker for q command', async () => {
    const result = await executeCommand('q');
    assert.strictEqual(result, '__EXIT__');
  });

  it('returns error for unknown command', async () => {
    const result = await executeCommand('unknown-command');
    assert.ok(result.includes('未知命令'));
    assert.ok(result.includes('unknown-command'));
  });

  it('returns error for skill without name', async () => {
    const result = await executeCommand('skill');
    assert.ok(result.includes('用法'));
    assert.ok(result.includes('skill'));
  });
});
