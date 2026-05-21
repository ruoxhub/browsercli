/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {ToolPrerequisiteChecker} from '../../../../src/tools/prerequisites/ToolPrerequisiteChecker.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';

test('throws PREREQUISITE when a page is required but unavailable', () => {
  const checker = new ToolPrerequisiteChecker({
    getSelectedPage: () => null,
    getDebuggerContext: async () => {
      throw new Error('not expected');
    },
  });

  assert.throws(
    () =>
      checker.check('injectHook', [
        {
          condition: 'requiresPage',
          fix: 'Start or attach a browser page first.',
        },
      ]),
    (error: unknown) =>
      error instanceof ToolError &&
      error.code === ErrorCodes.PREREQUISITE &&
      error.context?.fix === 'Start or attach a browser page first.',
  );
});

test('passes when a required page exists', () => {
  const checker = new ToolPrerequisiteChecker({
    getSelectedPage: () => ({url: () => 'https://example.test'}),
    getDebuggerContext: async () => ({}),
  });

  checker.check('injectHook', [
    {
      condition: 'requiresPage',
      fix: 'Start or attach a browser page first.',
    },
  ]);
});
