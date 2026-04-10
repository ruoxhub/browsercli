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
export type {Connection, CDPSession, Target} from 'puppeteer-core';

// MCP SDK
export {Client} from '@modelcontextprotocol/sdk/client/index.js';
export {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
export type {
  CallToolResult,
  ImageContent,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
export type ResourceType = string;

// Puppeteer exports - 使用真实类型，不手写接口
export {
  Locator,
  PredefinedNetworkConditions,
  CDPSessionEvent,
} from 'puppeteer-core';
export {default as puppeteer} from 'puppeteer-core';
export type * from 'puppeteer-core';
export type {Page as CdpPage} from 'puppeteer-core';
export {PipeTransport} from 'puppeteer-core/internal/node/PipeTransport.js';

// DevTools CDP 连接类型
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
