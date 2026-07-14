/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getBoolFlag,
  getFlag,
  hasFlag,
  parseArgs,
} from '../../src/args-parser.js';

describe('args-parser', () => {
  describe('parseArgs', () => {
    it('returns empty result for no arguments', () => {
      const result = parseArgs([]);
      assert.deepStrictEqual(result, {
        flags: {},
        positionals: [],
        unknown: [],
      });
    });

    it('parses --key value pairs', () => {
      const result = parseArgs(['--url', 'https://example.com']);
      assert.deepStrictEqual(result.flags, {url: 'https://example.com'});
      assert.deepStrictEqual(result.positionals, []);
    });

    it('parses --key=value syntax', () => {
      const result = parseArgs(['--url=https://example.com']);
      assert.deepStrictEqual(result.flags, {url: 'https://example.com'});
    });

    it('parses boolean flags without values', () => {
      const result = parseArgs(['--headless']);
      assert.strictEqual(result.flags.headless, true);
    });

    it('parses mixed flags and positionals', () => {
      const result = parseArgs([
        'start',
        '--browserUrl',
        'http://localhost:9222',
        '--headless',
      ]);
      assert.deepStrictEqual(result.positionals, ['start']);
      assert.strictEqual(result.flags.browserUrl, 'http://localhost:9222');
      assert.strictEqual(result.flags.headless, true);
    });

    it('parses multiple key-value pairs', () => {
      const result = parseArgs([
        '--name',
        'test-task',
        '--desc',
        'A test',
        '--url',
        'https://example.com',
      ]);
      assert.strictEqual(result.flags.name, 'test-task');
      assert.strictEqual(result.flags.desc, 'A test');
      assert.strictEqual(result.flags.url, 'https://example.com');
    });

    it('treats non-flag arguments as positionals', () => {
      const result = parseArgs(['foo', 'bar', 'baz']);
      assert.deepStrictEqual(result.positionals, ['foo', 'bar', 'baz']);
      assert.deepStrictEqual(result.flags, {});
    });

    it('handles short flags (-x)', () => {
      const result = parseArgs(['-v']);
      assert.strictEqual(result.flags.v, true);
    });

    it('handles short flags with values (-n value)', () => {
      const result = parseArgs(['-n', 'my-task']);
      assert.strictEqual(result.flags.n, 'my-task');
    });

    it('stops consuming value when next arg starts with dash', () => {
      const result = parseArgs(['--name', '--verbose']);
      assert.strictEqual(result.flags.name, true);
      assert.strictEqual(result.flags.verbose, true);
    });

    it('handles equals sign with empty value', () => {
      const result = parseArgs(['--name=']);
      assert.strictEqual(result.flags.name, '');
    });

    it('handles value containing equals sign', () => {
      const result = parseArgs(['--expr=a=b+c']);
      assert.strictEqual(result.flags.expr, 'a=b+c');
    });
  });

  describe('getFlag', () => {
    it('returns flag value', () => {
      const args = parseArgs(['--url', 'https://example.com']);
      assert.strictEqual(getFlag(args, 'url'), 'https://example.com');
    });

    it('returns default when flag missing', () => {
      const args = parseArgs([]);
      assert.strictEqual(getFlag(args, 'url', 'default'), 'default');
    });

    it('returns default for boolean flags', () => {
      const args = parseArgs(['--headless']);
      assert.strictEqual(getFlag(args, 'headless', 'default'), 'default');
    });

    it('returns undefined when no default and flag missing', () => {
      const args = parseArgs([]);
      assert.strictEqual(getFlag(args, 'missing'), undefined);
    });
  });

  describe('hasFlag', () => {
    it('returns true for existing flag', () => {
      const args = parseArgs(['--url', 'https://example.com']);
      assert.strictEqual(hasFlag(args, 'url'), true);
    });

    it('returns false for missing flag', () => {
      const args = parseArgs([]);
      assert.strictEqual(hasFlag(args, 'url'), false);
    });

    it('returns true for boolean flag', () => {
      const args = parseArgs(['--headless']);
      assert.strictEqual(hasFlag(args, 'headless'), true);
    });
  });

  describe('getBoolFlag', () => {
    it('returns true for boolean flag', () => {
      const args = parseArgs(['--headless']);
      assert.strictEqual(getBoolFlag(args, 'headless'), true);
    });

    it('returns false for missing flag', () => {
      const args = parseArgs([]);
      assert.strictEqual(getBoolFlag(args, 'headless'), false);
    });

    it('returns default value when missing', () => {
      const args = parseArgs([]);
      assert.strictEqual(getBoolFlag(args, 'headless', true), true);
    });

    it('parses string "true" as boolean true', () => {
      const args = parseArgs(['--flag', 'true']);
      assert.strictEqual(getBoolFlag(args, 'flag'), true);
    });

    it('parses string "1" as boolean true', () => {
      const args = parseArgs(['--flag', '1']);
      assert.strictEqual(getBoolFlag(args, 'flag'), true);
    });

    it('parses string "false" as boolean false', () => {
      const args = parseArgs(['--flag', 'false']);
      assert.strictEqual(getBoolFlag(args, 'flag'), false);
    });

    it('parses other strings as boolean false', () => {
      const args = parseArgs(['--flag', 'anything']);
      assert.strictEqual(getBoolFlag(args, 'flag'), false);
    });
  });
});
