/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  ensureBrowserConnected,
  resolveAutoConnectTarget,
  launch,
  ensureBrowserLaunched,
  BrowserManager,
} from './browser.js';
export type {
  BrowserManagerConfig,
  Channel
} from './browser.js';

export {PlaywrightDevToolsConnection as PuppeteerDevToolsConnection} from './DevToolsConnectionAdapter.js';

export {SessionManager} from './SessionManager.js';

export {HARMFUL_ARGS, DEFAULT_ARGS, STEALTH_ARGS} from './stealth-args.js';
