/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {AxiError} from 'axi-sdk-js';

import {daemonError, toAxiError, toolError} from '../../src/errors.js';

describe('errors', () => {
  describe('toAxiError', () => {
    it('passes through existing AxiError unchanged', () => {
      const original = new AxiError('original', 'CODE');
      const result = toAxiError(original);
      assert.strictEqual(result, original);
    });

    it('converts Error to AxiError with message and suggestions', () => {
      const err = new Error('connection refused');
      const result = toAxiError(err, 'CONN_ERROR');
      assert.ok(result instanceof AxiError);
      assert.strictEqual(result.message, 'connection refused');
      assert.strictEqual(result.code, 'CONN_ERROR');
      assert.ok(result.suggestions.length > 0);
    });

    it('uses INTERNAL as default code for Error', () => {
      const err = new Error('something broke');
      const result = toAxiError(err);
      assert.strictEqual(result.code, 'INTERNAL');
    });

    it('converts unknown types via String()', () => {
      const result = toAxiError(null);
      assert.ok(result instanceof AxiError);
      assert.strictEqual(result.message, 'null');
    });

    it('converts string values', () => {
      const result = toAxiError('raw error string');
      assert.ok(result instanceof AxiError);
      assert.strictEqual(result.message, 'raw error string');
    });

    it('converts number values', () => {
      const result = toAxiError(42);
      assert.ok(result instanceof AxiError);
      assert.strictEqual(result.message, '42');
    });
  });

  describe('daemonError', () => {
    it('creates error with action and WORKER_ERROR code', () => {
      const result = daemonError('start');
      assert.ok(result instanceof AxiError);
      assert.ok(result.message.includes('Failed to start'));
      assert.ok(result.message.includes('Worker unavailable'));
      assert.strictEqual(result.code, 'WORKER_ERROR');
    });

    it('includes detail suggestion when provided', () => {
      const result = daemonError('connect', 'Browser not responding');
      assert.ok(result.suggestions[0].includes('Browser not responding'));
    });

    it('always includes daemon launch hint', () => {
      const result = daemonError('stop');
      assert.ok(
        result.suggestions.some((s: string) => s.includes('browsercli start')),
      );
    });
  });

  describe('toolError', () => {
    it('creates error with tool name and TOOL_ERROR code', () => {
      const result = toolError('screenshot', 'timeout');
      assert.ok(result instanceof AxiError);
      assert.ok(result.message.includes('screenshot'));
      assert.ok(result.message.includes('timeout'));
      assert.strictEqual(result.code, 'TOOL_ERROR');
    });

    it('includes worker verification suggestion', () => {
      const result = toolError('hook', 'invalid params');
      assert.ok(
        result.suggestions.some((s: string) =>
          s.toLowerCase().includes('worker'),
        ),
      );
    });
  });
});
