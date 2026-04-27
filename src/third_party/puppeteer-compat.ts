/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ─── Puppeteer Compatible Types ───
// These types are kept for backward compatibility with code
// that was originally written for Puppeteer.

import type {CDPSession} from 'patchright';

// Puppeteer used 'Target' which doesn't exist in Playwright.
// In Playwright, browser targets are accessed via BrowserContext.
// We provide a minimal Target-like interface for compatibility.
export interface Target {
  url(): string;
  type(): string;
}

// Puppeteer's Connection type - not directly available in Playwright.
// We provide a minimal interface for the DevToolsConnectionAdapter.
export interface Connection {
  session(sessionId: string): CDPSession | null;
}

// Puppeteer's Page events type - for modules/collector/PageCollector.ts
export interface PuppeteerPageEvents {
  console: unknown;
  dialog: unknown;
  request: unknown;
  response: unknown;
  requestfinished: unknown;
  requestfailed: unknown;
  frameattached: unknown;
  framedetached: unknown;
  framenavigated: unknown;
  pageerror: unknown;
  popup: unknown;
  close: unknown;
}

// Handler type for event handlers
export type Handler<T = unknown> = (event: T) => void;
