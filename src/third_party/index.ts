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

// MCP SDK
export {Client} from '@modelcontextprotocol/sdk/client/index.js';
export {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
export type {
  CallToolResult,
  ImageContent,
  TextContent,
  ResourceType,
} from '@modelcontextprotocol/sdk/types.js';

// Puppeteer exports
export {
  Locator,
  PredefinedNetworkConditions,
  CDPSessionEvent,
} from 'puppeteer-core';
export {default as puppeteer} from 'puppeteer-core';
export type * from 'puppeteer-core';
export type {CdpPage} from 'puppeteer-core/internal/cdp/Page.js';
export {PipeTransport} from 'puppeteer-core/internal/node/PipeTransport.js';

// DevTools CDP 连接类型
export type CDPCommand = string;
export type CDPError = {code: number; message: string};
export type CommandParams<T extends CDPCommand> = Record<string, unknown>;
export type CommandResult<T extends CDPCommand> = Record<string, unknown>;

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

// 本地 DevTools 类型定义 - 避免 chrome-devtools-frontend 路径问题
export type Connection = {
  session: (sessionId: string) => CDPSession | undefined;
};

export type CDPSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
  detach: () => Promise<void>;
  id?: string;
};

export type Page = {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback: (...args: unknown[]) => void) => void;
  url: () => string;
  close: () => Promise<void>;
  isClosed: () => boolean;
  mainFrame: () => unknown;
  setDefaultTimeout: (timeout: number) => void;
  setDefaultNavigationTimeout: (timeout: number) => void;
  getDefaultNavigationTimeout: () => number;
  frames: () => unknown[];
  evaluate: <T>(
    pageFunction: string | (() => T),
    ...args: unknown[]
  ) => Promise<T>;
  // CDP Session 相关方法
  createCDPSession: () => Promise<CDPSession>;
  // 其他常用方法
  goto: (
    url: string,
    options?: {timeout?: number; waitUntil?: string},
  ) => Promise<unknown>;
  reload: () => Promise<unknown>;
  goBack: () => Promise<unknown>;
  goForward: () => Promise<unknown>;
  title: () => Promise<string>;
  screenshot: (options?: {
    type?: string;
    fullPage?: boolean;
  }) => Promise<unknown>;
  content: () => Promise<string>;
  setContent: (html: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  type: (selector: string, text: string) => Promise<void>;
  waitForSelector: (
    selector: string,
    options?: {timeout?: number},
  ) => Promise<unknown>;
  waitForNavigation: (options?: {timeout?: number}) => Promise<unknown>;
  $: (selector: string) => Promise<unknown>;
  $$: (selector: string) => Promise<unknown[]>;
  $eval: <T>(
    selector: string,
    pageFunction: string | (() => T),
    ...args: unknown[]
  ) => Promise<T>;
  $$eval: <T>(
    selector: string,
    pageFunction: string | (() => T),
    ...args: unknown[]
  ) => Promise<T>;
};

export type Browser = {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  close: () => Promise<void>;
  connected: boolean;
  pages: () => Page[];
};

export type ConsoleMessage = {
  type: () => string;
  text: () => string;
  args: () => Array<{jsonValue: () => Promise<unknown>}>;
};

export type Dialog = unknown;
export type Frame = unknown;
export type HTTPRequest = unknown;

// Protocol 命名空间
// eslint-disable-next-line @typescript-eslint/no-namespace
// eslint-disable-next-line @typescript-eslint/no-namespace
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
  export type ScriptParsedEvent = {
    scriptId: string;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    hash: string;
    sourceMapURL?: string;
  };

  export type PausedCallFrame = {
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
  };

  export type PausedEvent = {
    callFrames: PausedCallFrame[];
    reason: string;
    data?: unknown;
    hitBreakpoints?: string[];
  };

  export type ResumedEvent = void;

  export type ScriptFailedToParseEvent = {
    scriptId: string;
    url: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    hash: string;
    sourceMapURL?: string;
  };

  export type SetBreakpointByUrlRequest = {
    urlFilter?: string;
    url?: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  };

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

  export interface Audits {
    issueAdded: unknown;
  }
}

export type Handler<T = unknown> = (event: T) => void;

export type AggregatedIssue = {
  code: () => string;
  title: () => string;
  description: () => string | null;
  getDescription?: () => string | null;
  primaryKey: () => string;
  getAggregatedIssuesCount?: () => number;
};

export type Issue = unknown;
export type IssuesManagerEventTypes = unknown;

// Mock objects for chrome-devtools-frontend runtime values
// These are stub implementations to satisfy type checking after removing the dependency
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Common {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class ObjectWrapper<T = unknown> {
    emit(_event: string, _data?: T): void {}
    addEventListener(
      _event: string,
      _listener: (...args: unknown[]) => void,
    ): void {}
    removeEventListener(
      _event: string,
      _listener: (...args: unknown[]) => void,
    ): void {}
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

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace I18n {
  export namespace DevToolsLocale {
    export const DevToolsLocale = {
      instance: (_opts: {create: boolean; data: unknown}): unknown => ({}),
    };
  }
  export const i18n = {
    registerLocaleDataForTest: (_locale: string, _data: unknown): void => {},
  };
}

// MCP SDK 类型 (已移除，保留用于兼容)
export type CallToolResult = {
  content?: Array<{type: string; text?: string; data?: unknown}>;
  isError?: boolean;
};

export type ImageContent = {type: 'image'; data: string; mimeType: string};
export type TextContent = {type: 'text'; text: string};
export type ResourceType = string;

// PageCollector 需要的类型
export type Target = unknown;
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PageEvents {
  export type FrameNavigated = unknown;
}

// DevTools 命名空间 - 用于 DevToolsConnectionAdapter.ts
// eslint-disable-next-line @typescript-eslint/no-namespace
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
  export type CommandParams<T extends Command> = unknown;
  export type CommandResult<T extends Command> = unknown;

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
