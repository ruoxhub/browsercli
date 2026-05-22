/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  listOutput,
  successOutput,
  tableOutput,
} from '../../../src/cli/output.js';

describe('output', () => {

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
