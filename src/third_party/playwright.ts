/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Import types that are also used locally in this file
import type {CDPSession as PlaywrightCDPSession} from 'patchright';

// Re-export all Playwright types for downstream consumers
export type {
  Browser,
  BrowserContext,
  Page,
  Frame,
  CDPSession,
  JSHandle,
  ElementHandle,
  ConsoleMessage,
  Dialog,
  Download,
  FileChooser,
  Keyboard,
  Mouse,
  Touchscreen,
  Request,
  Response,
  Route,
  WebSocket as PlaywrightWebSocket,
  Worker,
  BrowserType,
  Selectors,
} from 'patchright';

// Re-export the chromium instance creator
export {chromium, firefox, webkit} from 'patchright';

// Playwright's Locator type
export type {Locator} from 'patchright';

// Puppeteer's HTTPRequest/HTTPResponse - map to Playwright's Request/Response
export type {
  Request as HTTPRequest,
  Response as HTTPResponse,
} from 'patchright';

// ResourceType - Playwright uses string union type
export type ResourceType =
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'text-track'
  | 'xhr'
  | 'fetch'
  | 'event-source'
  | 'websocket'
  | 'manifest'
  | 'signed-exchange'
  | 'ping'
  | 'csp-violation-report'
  | 'preflight'
  | 'other';

// CdpPage type alias for backward compatibility
export type {Page as CdpPage} from 'patchright';
