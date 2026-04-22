/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import 'core-js/modules/es.promise.with-resolvers.js';
import 'core-js/proposals/iterator-helpers.js';

export type {Options as YargsOptions} from 'yargs';
export {default as yargs} from 'yargs';
export {hideBin} from 'yargs/helpers';
export {default as debug} from 'debug';
export type {Debugger} from 'debug';
export {z as zod} from 'zod';

// ─── Playwright exports (replaces Puppeteer) ───
// Re-export commonly used Playwright types for the rest of the codebase.
// All downstream code should import from this barrel file, not from 'playwright-core' directly.

// Import types that are also used locally in this file
import type {
  CDPSession as PlaywrightCDPSession,
} from 'playwright-core';

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
} from 'playwright-core';

// Re-export the chromium instance creator
export {chromium, firefox, webkit} from 'playwright-core';

// CDP-specific types - Playwright uses CDPSession differently from Puppeteer
// We map Puppeteer concepts to Playwright equivalents where possible.

// ─── Type aliases for backward compatibility ───
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
  session(sessionId: string): PlaywrightCDPSession | null;
}

// Puppeteer's ChromeReleaseChannel - Playwright uses string channel names directly
export type ChromeReleaseChannel =
  | 'chrome'
  | 'chrome-beta'
  | 'chrome-dev'
  | 'chrome-canary'
  | 'msedge'
  | 'msedge-beta'
  | 'msedge-dev'
  | 'msedge-canary';

// Puppeteer's LaunchOptions - map to Playwright's launch options
export interface LaunchOptions {
  channel?: ChromeReleaseChannel;
  executablePath?: string;
  headless?: boolean;
  args?: string[];
  userDataDir?: string;
  ignoreDefaultArgs?: string[] | boolean;
  acceptInsecureCerts?: boolean;
  defaultViewport?: null;
  pipe?: boolean;
  handleDevToolsAsPage?: boolean;
  targetFilter?: (target: Target) => boolean;
  ignoreHTTPSErrors?: boolean;
}

// Puppeteer's CDPSessionEvent - Playwright doesn't have this enum.
// We provide the event names as constants.
export const CDPSessionEvent = {
  SessionAttached: 'sessionattached',
  SessionDetached: 'sessiondetached',
  Disconnected: 'disconnected',
} as const;

export type CDPSessionEventType = (typeof CDPSessionEvent)[keyof typeof CDPSessionEvent];

// Puppeteer's PredefinedNetworkConditions - not in Playwright.
// We provide the common presets.
export const PredefinedNetworkConditions = {
  'Slow 3G': {
    offline: false,
    downloadThroughput: 50 * 1024 / 8,
    uploadThroughput: 50 * 1024 / 8,
    latency: 2000,
  },
  'Fast 3G': {
    offline: false,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
    latency: 562.5,
  },
} as const;

// Puppeteer's Locator - Playwright has its own Locator type
export type {Locator} from 'playwright-core';

// Puppeteer's HTTPRequest/HTTPResponse - map to Playwright's Request/Response
export type {Request as HTTPRequest, Response as HTTPResponse} from 'playwright-core';

// ResourceType - Playwright uses string union type
export type ResourceType = 'document' | 'stylesheet' | 'image' | 'media' | 'font' | 'script' | 'texttrack' | 'xhr' | 'fetch' | 'eventsource' | 'websocket' | 'manifest' | 'signedexchange' | 'ping' | 'cspviolationreport' | 'preflight' | 'other';

// PipeTransport - not available in Playwright, provide stub
export const PipeTransport = class PipeTransport {
  // Stub - Playwright uses different transport mechanisms
};

// CdpPage type alias for backward compatibility
export type {Page as CdpPage} from 'playwright-core';

// ─── DevTools CDP 连接类型 ───
export type CDPCommand = string;
export interface CDPError {
  code: number;
  message: string;
}
export type CommandParams<_T extends CDPCommand> = Record<string, unknown>;
export type CommandResult<_T extends CDPCommand = CDPCommand> = Record<
  string,
  unknown
>;

export interface CDPConnectionObserver {
  onEvent: (event: {
    method: CDPCommand;
    sessionId?: string;
    params: Record<string, unknown>;
  }) => void;
  onDisconnect?: () => void;
}

export interface CDPConnection {
  observe: (observer: CDPConnectionObserver) => void;
  unobserve: (observer: CDPConnectionObserver) => void;
  send: <T extends CDPCommand>(
    method: T,
    params: CommandParams<T>,
    sessionId: string | undefined,
  ) => Promise<{result: CommandResult<T>} | {error: CDPError}>;
}

/* eslint-disable @typescript-eslint/no-namespace */
// 本地 DevTools 类型定义 - 避免 chrome-devtools-frontend 路径问题

// Protocol 命名空间

export namespace Protocol {
  export interface Debugger {
    pause(): Promise<unknown>;
    resume(): Promise<unknown>;
    stepInto(): Promise<unknown>;
    stepOver(): Promise<unknown>;
    stepOut(): Promise<unknown>;
    setBreakpoint(params: unknown): Promise<unknown>;
    removeBreakpoint(params: unknown): Promise<unknown>;
    getScriptSource(params: unknown): Promise<unknown>;
    evaluateOnCallFrame(params: unknown): Promise<unknown>;
    searchInContent(params: unknown): Promise<unknown>;
    setBreakpointByUrl(params: unknown): Promise<unknown>;
    getPossibleBreakpoints(params: unknown): Promise<unknown>;
    setInstrumentationBreakpoint(params: unknown): Promise<unknown>;
    removeInstrumentationBreakpoint(params: unknown): Promise<unknown>;
    restartFrame(): Promise<unknown>;
    getBacktrace(): Promise<unknown>;
    setReturnValue(): Promise<unknown>;
    setBlackboxPatterns(): Promise<unknown>;
    setBlackboxedRanges(): Promise<unknown>;
    installedScripts(): Promise<unknown>;
    canSetScriptSource(): Promise<unknown>;
    stackTrace(): Promise<unknown>;
    enable(): Promise<unknown>;
    disable(): Promise<unknown>;
  }

  // CDP 事件类型 - 用于 DebuggerContext.ts 中的事件处理
  export interface ScriptParsedEvent {
    scriptId: string;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    hash: string;
    sourceMapURL?: string;
  }

  export interface PausedCallFrame {
    callFrameId: string;
    functionName: string;
    location: {
      scriptId: string;
      lineNumber: number;
      columnNumber: number;
    };
    url: string;
    scopeChain: Array<{
      type: string;
      object: {
        type: string;
        subtype?: string;
        className: string;
        value?: unknown;
        description?: string;
        objectId?: string;
      };
      name?: string;
      startLocation?: {
        scriptId: string;
        lineNumber: number;
        columnNumber: number;
      };
      endLocation?: {
        scriptId: string;
        lineNumber: number;
        columnNumber: number;
      };
    }>;
    this: {
      type: string;
      subtype?: string;
      className: string;
      value?: unknown;
      description?: string;
      objectId?: string;
    };
  }

  export interface PausedEvent {
    callFrames: PausedCallFrame[];
    reason: string;
    data?: unknown;
    hitBreakpoints?: string[];
  }

  export type ResumedEvent = void;

  export interface ScriptFailedToParseEvent {
    scriptId: string;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    hash: string;
    sourceMapURL?: string;
  }

  export interface SetBreakpointByUrlRequest {
    urlFilter?: string;
    url?: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }

  export interface Runtime {
    enable(): Promise<unknown>;
    disable(): Promise<unknown>;
    evaluate(params: unknown): Promise<unknown>;
    callFunctionOn(params: unknown): Promise<unknown>;
    getProperties(params: unknown): Promise<unknown>;
    releaseObject(params: unknown): Promise<unknown>;
    releaseObjectGroup(params: unknown): Promise<unknown>;
    runIfWaitingForDebugger(): Promise<unknown>;
    enablePageReporting(): Promise<unknown>;
    disablePageReporting(): Promise<unknown>;
  }

  export interface Network {
    requestWillBeSent: unknown;
    responseReceived: unknown;
    loadingFinished: unknown;
    loadingFailed: unknown;
    webSocketCreated: unknown;
    webSocketWillSendHandshakeRequest: unknown;
    webSocketHandshakeResponseReceived: unknown;
    webSocketFrameSent: unknown;
    webSocketFrameReceived: unknown;
    webSocketClosed: unknown;
    requestServedFromCache: unknown;
  }

  export namespace Network {
    export interface WebSocketCreatedEvent {
      requestId: string;
      url: string;
    }
    export interface WebSocketFrameSentEvent {
      requestId: string;
      timestamp: number;
      response: boolean;
      opcode: number;
      data: string;
    }
    export interface WebSocketFrameReceivedEvent {
      requestId: string;
      timestamp: number;
      response: boolean;
      opcode: number;
      data: string;
    }
    export interface WebSocketClosedEvent {
      requestId: string;
      timestamp: number;
      wasClean: boolean;
      statusCode: number;
    }
    export interface RequestWillBeSentEvent {
      requestId: string;
      loaderId: string;
      documentURL?: string;
      request: {
        url: string;
        method: string;
        headers: Record<string, string>;
      };
      timestamp: number;
      wallTime: number;
      initiator?: {
        type: string;
        stack?: {
          callFrames: Array<{
            functionName: string;
            scriptId: string;
            url: string;
            lineNumber: number;
            columnNumber: number;
          }>;
        };
      };
    }
  }

  export namespace Audits {
    export interface IssueAddedEvent {
      issue: unknown;
    }
  }

  // Page 域 - 用于 WaitForHelper.ts 和 PageCollector.ts

  export namespace Page {
    export interface FrameStartedNavigatingEvent {
      navigationType: string;
      frameId: string;
    }
  }
}

// Puppeteer Page 事件类型 - 用于 PageCollector.ts
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

export type Handler<T = unknown> = (event: T) => void;

export interface AggregatedIssue {
  code: () => string;
  title: () => string;
  description: () => string | null;
  getDescription?: () => string | null;
  primaryKey: () => string;
  getAggregatedIssuesCount?: () => number;
}

export type Issue = unknown;
export type IssuesManagerEventTypes = unknown;

// Mock objects for chrome-devtools-frontend runtime values
// These are stub implementations to satisfy type checking after removing the dependency
/* eslint-disable @typescript-eslint/no-namespace */
export namespace Common {
  export class ObjectWrapper<T = unknown> {
    emit(_event: string, _data?: T): void {
      /* no-op */
    }
    addEventListener(
      _event: string,
      _listener: (...args: unknown[]) => void,
    ): void {
      /* no-op */
    }
    removeEventListener(
      _event: string,
      _listener: (...args: unknown[]) => void,
    ): void {
      /* no-op */
    }
  }

  // EventTarget 类型 - 用于 PageCollector.ts

  export namespace EventTarget {
    export interface EventTargetEvent<T> {
      data: T;
    }
  }
}

export namespace Marked {
  export const Marked = {
    lexer: (_markdown: string): unknown[] => [],
  };
}

export namespace MarkdownIssueDescription {
  export const substitutePlaceholders = (
    _markdown: string,
    _subs: Record<string, unknown>,
  ): string => _markdown;
  export const findTitleFromMarkdownAst = (_ast: unknown): string | null =>
    null;
}

export namespace I18n {
  export namespace DevToolsLocale {
    export const DevToolsLocale = {
      instance: (_opts: {create: boolean; data: unknown}): unknown => ({}),
    };
  }
  export const i18n = {
    registerLocaleDataForTest: (_locale: string, _data: unknown): void => {
      /* no-op */
    },
  };
}

// PageCollector 需要的类型
export namespace PageEvents {
  export type FrameNavigated = unknown;
}

// DevTools 命名空间 - 用于 DevToolsConnectionAdapter.ts
export namespace devtools {
  // CDP 连接相关类型
  export interface CDPConnection {
    send<T extends string>(
      method: T,
      params: unknown,
      sessionId: string | undefined,
    ): Promise<{result: unknown} | {error: unknown}>;
    observe(observer: CDPConnectionObserver): void;
    unobserve(observer: CDPConnectionObserver): void;
  }

  export interface CDPConnectionObserver {
    onCommand?: (command: CDPCommand) => void;
    onError?: (error: CDPError) => void;
  }

  export interface CDPCommand {
    method: string;
    params?: unknown;
    sessionId?: string;
  }

  export interface CDPError {
    code: number;
    message: string;
    data?: unknown;
  }

  export type Command = string;
  export type CommandParams = unknown;
  export type CommandResult = unknown;

  // Protocol 命令类型
  export interface Debugger {
    pause(): Promise<unknown>;
    resume(): Promise<unknown>;
    stepInto(): Promise<unknown>;
    stepOver(): Promise<unknown>;
    stepOut(): Promise<unknown>;
    setBreakpoint(params: unknown): Promise<unknown>;
    removeBreakpoint(params: unknown): Promise<unknown>;
    getScriptSource(params: unknown): Promise<unknown>;
    evaluateOnCallFrame(params: unknown): Promise<unknown>;
    searchInContent(params: unknown): Promise<unknown>;
    setBreakpointByUrl(params: SetBreakpointByUrlRequest): Promise<unknown>;
    getPossibleBreakpoints(params: unknown): Promise<unknown>;
    setInstrumentationBreakpoint(params: unknown): Promise<unknown>;
    removeInstrumentationBreakpoint(params: unknown): Promise<unknown>;
    restartFrame(): Promise<unknown>;
    getBacktrace(): Promise<unknown>;
    setReturnValue(): Promise<unknown>;
    setBlackboxPatterns(): Promise<unknown>;
    setBlackboxedRanges(): Promise<unknown>;
    installedScripts(): Promise<unknown>;
    canSetScriptSource(): Promise<unknown>;
    stackTrace(): Promise<unknown>;
    enable(): Promise<unknown>;
    disable(): Promise<unknown>;
  }

  export interface SetBreakpointByUrlRequest {
    url?: string;
    urlRegex?: string;
    scriptHash?: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }
}
