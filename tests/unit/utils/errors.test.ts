/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  createToolError,
  ErrorCodes,
  formatError,
  ToolError,
  type ToolErrorOptions,
  type ToolRecovery,
} from '../../../src/utils/errors.js';

describe('error codes', () => {
  it('defines all canonical error codes', () => {
    assert.strictEqual(ErrorCodes.BROWSER_REQUIRED, 'BROWSER_REQUIRED');
    assert.strictEqual(ErrorCodes.PAGE_REQUIRED, 'PAGE_REQUIRED');
    assert.strictEqual(ErrorCodes.FRAME_REQUIRED, 'FRAME_REQUIRED');
    assert.strictEqual(ErrorCodes.DEBUGGER_PAUSED, 'DEBUGGER_PAUSED');
    assert.strictEqual(ErrorCodes.DEBUGGER_NOT_PAUSED, 'DEBUGGER_NOT_PAUSED');
    assert.strictEqual(ErrorCodes.NATIVE_TOOL_MISSING, 'NATIVE_TOOL_MISSING');
    assert.strictEqual(ErrorCodes.SCRIPT_ID_STALE, 'SCRIPT_ID_STALE');
    assert.strictEqual(ErrorCodes.PAGE_UNRESPONSIVE, 'PAGE_UNRESPONSIVE');
  });
});

describe('ToolError and options', () => {
  it('applies default retryable = false for non-retryable codes', () => {
    const nonRetryable = [
      ErrorCodes.VALIDATION,
      ErrorCodes.NOT_FOUND,
      ErrorCodes.PERMISSION,
      ErrorCodes.NATIVE_TOOL_MISSING,
    ];
    for (const code of nonRetryable) {
      const err = new ToolError(code, `${code} occurred`);
      assert.strictEqual(
        err.retryable,
        false,
        `${code} should have retryable=false by default`,
      );
      assert.strictEqual(
        err.recoverable,
        false,
        `${code} recoverable should match retryable`,
      );
    }
  });

  it('applies default retryable = true for other codes', () => {
    const retryableCodes = [
      ErrorCodes.RUNTIME,
      ErrorCodes.TIMEOUT,
      ErrorCodes.CONNECTION,
      ErrorCodes.BROWSER_REQUIRED,
      ErrorCodes.PAGE_REQUIRED,
      ErrorCodes.FRAME_REQUIRED,
      ErrorCodes.DEBUGGER_PAUSED,
      ErrorCodes.DEBUGGER_NOT_PAUSED,
      ErrorCodes.SCRIPT_ID_STALE,
      ErrorCodes.PAGE_UNRESPONSIVE,
    ];
    for (const code of retryableCodes) {
      const err = new ToolError(code, `${code} occurred`);
      assert.strictEqual(
        err.retryable,
        true,
        `${code} should have retryable=true by default`,
      );
      assert.strictEqual(
        err.recoverable,
        true,
        `${code} recoverable should match retryable`,
      );
    }
  });

  it('supports options object with retryable, recovery, and details', () => {
    const recovery: ToolRecovery = {
      tool: 'launch_browser',
      command: 'browsercli browser connect',
      reason: 'Browser must be running before attaching debugger',
    };
    const options: ToolErrorOptions = {
      retryable: false,
      recovery,
      details: {tabId: 1, attempts: 3},
    };
    const err = new ToolError(
      ErrorCodes.BROWSER_REQUIRED,
      'Browser is required',
      {foo: 'bar'},
      options,
    );

    assert.strictEqual(err.code, ErrorCodes.BROWSER_REQUIRED);
    assert.strictEqual(err.message, 'Browser is required');
    assert.deepStrictEqual(err.context, {foo: 'bar'});
    assert.strictEqual(err.retryable, false);
    assert.strictEqual(err.recoverable, false);
    assert.deepStrictEqual(err.recovery, recovery);
    assert.deepStrictEqual(err.details, {tabId: 1, attempts: 3});
  });

  it('supports boolean 4th argument for backward compatibility', () => {
    const errTrue = new ToolError(
      ErrorCodes.VALIDATION,
      'invalid',
      undefined,
      true,
    );
    assert.strictEqual(errTrue.retryable, true);
    assert.strictEqual(errTrue.recoverable, true);

    const errFalse = new ToolError(
      ErrorCodes.CONNECTION,
      'lost',
      undefined,
      false,
    );
    assert.strictEqual(errFalse.retryable, false);
    assert.strictEqual(errFalse.recoverable, false);
  });

  it('createToolError passes options to ToolError', () => {
    const recovery: ToolRecovery = {
      command: 'browsercli restart',
      reason: 'Restart required',
    };
    const err = createToolError(
      ErrorCodes.NATIVE_TOOL_MISSING,
      'wabt not installed',
      {binary: 'wasm2wat'},
      {retryable: true, recovery, details: {pkg: 'wabt'}},
    );

    assert.strictEqual(err.code, ErrorCodes.NATIVE_TOOL_MISSING);
    assert.strictEqual(err.retryable, true);
    assert.deepStrictEqual(err.recovery, recovery);
    assert.deepStrictEqual(err.details, {pkg: 'wabt'});
  });
});

describe('error formatting', () => {
  it('formats ToolError with recovery, details, and retryable', () => {
    const recovery: ToolRecovery = {
      tool: 'navigate_page',
      reason: 'Navigate to target page first',
    };
    const err = new ToolError(
      ErrorCodes.PAGE_REQUIRED,
      'No active page',
      {pageId: 'p1'},
      {
        retryable: true,
        recovery,
        details: {availablePages: 0},
      },
    );

    const result = formatError(err);
    assert.strictEqual(result.code, ErrorCodes.PAGE_REQUIRED);
    assert.strictEqual(result.type, 'ToolError');
    assert.strictEqual(result.message, 'No active page');
    assert.deepStrictEqual(result.context, {pageId: 'p1'});
    assert.strictEqual(result.retryable, true);
    assert.deepStrictEqual(result.recovery, recovery);
    assert.deepStrictEqual(result.details, {availablePages: 0});
  });

  it('omits recovery and details when not present on ToolError', () => {
    const err = new ToolError(ErrorCodes.RUNTIME, 'Something failed');
    const result = formatError(err);

    assert.strictEqual(result.code, ErrorCodes.RUNTIME);
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(result.recovery, undefined);
    assert.strictEqual(result.details, undefined);
  });

  it('formats Error instances', () => {
    const result = formatError(
      new Error('boom'),
      ErrorCodes.TOOL_EXECUTION_ERROR,
      {
        tool: 'x',
      },
    );

    assert.strictEqual(result.code, ErrorCodes.TOOL_EXECUTION_ERROR);
    assert.strictEqual(result.type, 'Error');
    assert.strictEqual(result.message, 'boom');
    assert.deepStrictEqual(result.context, {tool: 'x'});
  });

  it('formats unknown values', () => {
    const result = formatError('bad');

    assert.strictEqual(result.type, 'UnknownError');
    assert.strictEqual(result.message, 'bad');
  });
});
