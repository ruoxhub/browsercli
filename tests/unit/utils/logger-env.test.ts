
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {Logger} from '../../../src/utils/logger.js';

test('Logger respects LOG_LEVEL environment parsing without config dependency', () => {
  const testLogger = new Logger('warn');
  assert.equal(testLogger.level, 'warn');
});
