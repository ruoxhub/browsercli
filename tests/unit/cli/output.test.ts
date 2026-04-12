/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  listOutput,
  renderError,
  renderOutput,
  successOutput,
  tableOutput,
} from '../../../src/cli/output.js';

describe('output', () => {
  describe('renderOutput', () => {
    it('returns strings unchanged', () => {
      assert.strictEqual(renderOutput('hello'), 'hello');
    });

    it('stringifies objects as pretty JSON', () => {
      const result = renderOutput({status: 'ok'});
      assert.strictEqual(result, '{\n  "status": "ok"\n}');
    });

    it('handles nested objects', () => {
      const result = renderOutput({a: {b: 1}});
      const parsed = JSON.parse(result);
      assert.deepStrictEqual(parsed, {a: {b: 1}});
    });
  });

  describe('renderError', () => {
    it('renders message only', () => {
      const result = renderError('something failed');
      assert.strictEqual(result, 'Error: something failed');
    });

    it('renders message with code', () => {
      const result = renderError('not found', 'NOT_FOUND');
      assert.ok(result.includes('Error: not found'));
      assert.ok(result.includes('Code: NOT_FOUND'));
    });

    it('renders message with code and suggestions', () => {
      const result = renderError('fail', 'ERR', ['try again', 'check logs']);
      assert.ok(result.includes('Error: fail'));
      assert.ok(result.includes('Code: ERR'));
      assert.ok(result.includes('Suggestions:'));
      assert.ok(result.includes('  - try again'));
      assert.ok(result.includes('  - check logs'));
    });

    it('omits suggestions section when empty', () => {
      const result = renderError('fail', 'ERR', []);
      assert.ok(!result.includes('Suggestions:'));
    });

    it('omits suggestions section when undefined', () => {
      const result = renderError('fail', 'ERR');
      assert.ok(!result.includes('Suggestions:'));
    });
  });

  describe('successOutput', () => {
    it('adds status: success', () => {
      const result = successOutput({});
      assert.strictEqual(result.status, 'success');
    });

    it('merges provided data', () => {
      const result = successOutput({pid: 1234, socket: '/tmp/test'});
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.pid, 1234);
      assert.strictEqual(result.socket, '/tmp/test');
    });

    it('does not allow overriding status', () => {
      const result = successOutput({status: 'failed'});
      assert.strictEqual(result.status, 'success');
    });
  });

  describe('tableOutput', () => {
    it('creates structured output with headers and rows', () => {
      const result = tableOutput(['Name', 'Age'], [['Alice', '30']]);
      assert.deepStrictEqual(result.headers, ['Name', 'Age']);
      assert.deepStrictEqual(result.rows, [['Alice', '30']]);
    });

    it('handles empty rows', () => {
      const result = tableOutput(['Col'], []);
      assert.deepStrictEqual(result.headers, ['Col']);
      assert.deepStrictEqual(result.rows, []);
    });
  });

  describe('listOutput', () => {
    it('creates output with items', () => {
      const result = listOutput(['a', 'b', 'c']);
      assert.deepStrictEqual(result.items, ['a', 'b', 'c']);
    });

    it('adds title when provided', () => {
      const result = listOutput(['x'], 'My List');
      assert.deepStrictEqual(result.items, ['x']);
      assert.strictEqual(result.title, 'My List');
    });

    it('omits title when not provided', () => {
      const result = listOutput(['x']);
      assert.strictEqual(result.title, undefined);
    });
  });
});
