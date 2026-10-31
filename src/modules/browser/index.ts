/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  ensureBrowserConnected,
  resolveAutoConnectTarget,
  findActiveDevToolsPort,
  readDevToolsActivePort,
  getDevToolsActivePortPaths,
  launch,
  ensureBrowserLaunched,
  BrowserManager,
  isPatchrightDetachedFrameError,
  isPatchrightSessionClosedError,
} from './browser.js';
export type {BrowserManagerConfig, Channel} from './browser.js';

export {PlaywrightDevToolsConnection as PuppeteerDevToolsConnection} from './DevToolsConnectionAdapter.js';

export {HARMFUL_ARGS, DEFAULT_ARGS, STEALTH_ARGS} from './stealth-args.js';

export {mapCDPError, isCDPSessionGone, wrapCDPCall} from './CDPErrorMapper.js';

export {BrowserTargetInspector} from './BrowserTargetInspector.js';
export type {
  BrowserTargetInspectorOptions,
  DumpTargetScriptsResult,
  ScriptFailure,
  TargetSummary,
} from './BrowserTargetInspector.js';
