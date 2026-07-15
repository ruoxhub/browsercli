/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Test setup file
 * Loaded before running tests
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub: suppress console output during tests
    log: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub: suppress console output during tests
    debug: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub: suppress console output during tests
    info: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub: suppress console output during tests
    warn: () => {},
  };
}
