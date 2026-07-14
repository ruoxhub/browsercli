/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  resolveTraceOutputMode,
  withOptionalTraceIdContent,
} from '../../../../src/tools/shared/trace-output.js';

describe('resolveTraceOutputMode', () => {
  it('returns request mode when explicitly set to all', () => {
    assert.equal(resolveTraceOutputMode(undefined, 'all'), 'all');
  });

  it('returns request mode when explicitly set to errors', () => {
    assert.equal(resolveTraceOutputMode('all', 'errors'), 'errors');
  });

  it('falls back to global mode when request mode is invalid', () => {
    assert.equal(resolveTraceOutputMode('all', undefined), 'all');
    assert.equal(resolveTraceOutputMode('all', 'invalid'), 'all');
  });

  it('defaults to errors when neither is set', () => {
    assert.equal(resolveTraceOutputMode(undefined, undefined), 'errors');
  });
});

describe('withOptionalTraceIdContent', () => {
  it('returns content unchanged when mode is not all', () => {
    const content = [{type: 'text', text: 'hello'}];
    const result = withOptionalTraceIdContent(content, 'trace-123', 'errors');
    assert.deepEqual(result, content);
  });

  it('prepends traceId when mode is all', () => {
    const content = [{type: 'text', text: 'hello'}];
    const result = withOptionalTraceIdContent(content, 'trace-123', 'all');
    assert.equal(result.length, 2);
    assert.deepEqual(JSON.parse(result[0].text!), {traceId: 'trace-123'});
    assert.equal(result[1].text, 'hello');
  });

  it('returns content unchanged when mode is undefined', () => {
    const content = [{type: 'text', text: 'hello'}];
    const result = withOptionalTraceIdContent(content, 'trace-123', undefined);
    assert.deepEqual(result, content);
  });
});
