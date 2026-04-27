/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

// ─── Protocol 命名空间 ───
// 本地 DevTools 类型定义 - 避免 chrome-devtools-frontend 路径问题

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

  // Page 域 - 用于 WaitForHelper.ts 和 modules/collector/PageCollector.ts
  export namespace Page {
    export interface FrameStartedNavigatingEvent {
      navigationType: string;
      frameId: string;
    }
  }
}
