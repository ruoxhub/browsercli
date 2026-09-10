/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  classifyElementError,
  toElementError,
} from '../../../../src/tools/shared/elementLocator.js';
import {
  createToolError,
  ErrorCodes,
  ToolError,
} from '../../../../src/utils/errors.js';

describe('elementLocator', () => {
  describe('classifyElementError', () => {
    it('classifies TimeoutError as transient with TIMEOUT code', () => {
      const timeoutErr = new Error('Timeout 1200ms exceeded.');
      timeoutErr.name = 'TimeoutError';

      const result = classifyElementError(timeoutErr);
      assert.equal(result.kind, 'transient');
      assert.equal(result.code, ErrorCodes.TIMEOUT);
      assert.match(result.suggestion ?? '', /wait_for_element/);
    });

    it('classifies timeout regex match as transient even if error.name is generic Error', () => {
      const err = new Error('locator.click: Timeout 5000ms exceeded.');
      const result = classifyElementError(err);
      assert.equal(result.kind, 'transient');
      assert.equal(result.code, ErrorCodes.TIMEOUT);
    });

    it('classifies strict mode violation as permanent with ELEMENT_LOCATOR_AMBIGUOUS code', () => {
      const err = new Error(
        "Error: strict mode violation: locator('role=button') resolved to 3 elements",
      );
      const result = classifyElementError(err);
      assert.equal(result.kind, 'permanent');
      assert.equal(result.code, ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS);
      assert.equal(result.candidatesCount, 3);
      assert.match(result.suggestion ?? '', />> nth=N/);
    });

    it('classifies syntax parsing error as permanent with VALIDATION code', () => {
      const err = new Error(
        'Error: Unexpected token "%" while parsing css selector',
      );
      const result = classifyElementError(err);
      assert.equal(result.kind, 'permanent');
      assert.equal(result.code, ErrorCodes.VALIDATION);
    });

    it('does NOT misclassify Node is not an HTMLInputElement as VALIDATION', () => {
      const err = new Error(
        'locator.setInputFiles: Node is not an HTMLInputElement',
      );
      const result = classifyElementError(err);
      assert.equal(result.kind, 'permanent');
      assert.equal(result.code, ErrorCodes.RUNTIME);
    });

    it('classifies generic unknown error as permanent RUNTIME', () => {
      const err = new Error('Target closed');
      const result = classifyElementError(err);
      assert.equal(result.kind, 'permanent');
      assert.equal(result.code, ErrorCodes.RUNTIME);
    });
  });

  describe('toElementError', () => {
    it('creates a ToolError with retryable=true for timeout errors', () => {
      const timeoutErr = new Error('Timeout 10000ms exceeded');
      timeoutErr.name = 'TimeoutError';

      const toolErr = toElementError(timeoutErr, {
        toolName: 'click',
        selector: 'button.submit',
      });

      assert.equal(toolErr instanceof ToolError, true);
      assert.equal(toolErr.code, ErrorCodes.TIMEOUT);
      assert.equal(toolErr.retryable, true);
      assert.equal(toolErr.context?.toolName, 'click');
      assert.equal(toolErr.context?.selector, 'button.submit');
    });

    it('creates a ToolError with retryable=false for strict mode violation', () => {
      const err = new Error(
        "strict mode violation: locator('button') resolved to 2 elements",
      );
      const toolErr = toElementError(err, {
        toolName: 'click',
        selector: 'button',
      });

      assert.equal(toolErr.code, ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS);
      assert.equal(toolErr.retryable, false);
      assert.equal(toolErr.context?.candidatesCount, 2);
      assert.match(String(toolErr.context?.suggestion), />> nth=N/);
    });

    it('passes through existing ToolError untouched', () => {
      const original = createToolError(ErrorCodes.PAGE_REQUIRED, 'Page needed');
      const result = toElementError(original, {
        toolName: 'click',
        selector: 'div',
      });
      assert.equal(result, original);
    });
  });
});
