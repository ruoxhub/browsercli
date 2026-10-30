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

// Keep in sync with tests/setup.ts: the browser config parsers read these
// directly, so a machine that exports them would change test verdicts. Every
// npm script loads the COMPILED build/tests/setup.js, but a hand-run
// `--require tests/setup.js` would otherwise get different results.
delete process.env.BROWSER_EGO;
delete process.env.BROWSER_KEEP_PAGE;
delete process.env.BROWSER_EGO_PROFILE;

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
