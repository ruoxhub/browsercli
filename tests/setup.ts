/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Test setup file
 * Loaded before running tests
 */

process.env.NODE_ENV = 'test';

// The browser config parsers read these directly (the CLI cannot afford to pull
// the whole config graph in just to read a boolean), so a developer or CI machine
// that exports them changes test verdicts: `browserRequests.test.js` and the
// daemon suite fail with `BROWSER_EGO=true`, the CLI suite with
// `BROWSER_KEEP_PAGE=true`. `BROWSER_EGO_PROFILE` is the same hazard and worse:
// `browser connect --ego=false` is rejected before it is ever sent, so the
// "reaches the daemon" assertions fail. Tests that care set them explicitly and
// restore what they found, so clearing them here makes the suites hermetic.
delete process.env.BROWSER_EGO;
delete process.env.BROWSER_KEEP_PAGE;
delete process.env.BROWSER_EGO_PROFILE;

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
