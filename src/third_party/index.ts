/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Core JS Polyfills ───
import 'core-js/modules/es.promise.with-resolvers.js';
import 'core-js/proposals/iterator-helpers.js';

// ─── NPM Package Re-exports ───
export type {Options as YargsOptions} from 'yargs';
export {default as yargs} from 'yargs';
export {hideBin} from 'yargs/helpers';
export {default as debug} from 'debug';
export type {Debugger} from 'debug';
export {z as zod} from 'zod';

// ─── Sub-module Re-exports ───
// Playwright types and browser instances
export * from './playwright.js';
// Puppeteer-compatible types (Target, Connection, Handler, etc.)
export type * from './puppeteer-compat.js';
// CDP Protocol types (Protocol namespace, CDPConnection, etc.)
export type * from './cdp.js';
// Stub implementations (Common, Marked, MarkdownIssueDescription, I18n)
export * from './stubs.js';

// ─── AggregatedIssue (used by multiple modules) ───
export interface AggregatedIssue {
  code: () => string;
  title: () => string;
  description: () => string | null;
  getDescription?: () => string | null;
  primaryKey: () => string;
  getAggregatedIssuesCount?: () => number;
}

export type Issue = unknown;
