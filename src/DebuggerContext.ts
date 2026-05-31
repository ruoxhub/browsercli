/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPSession, Protocol} from './third_party/index.js';
import {
  createExecutionContextInfo,
  type ExecutionContextInfo,
  type RawExecutionContextDescription,
} from './tools/debugger/executionContexts.js';

// 类型别名，用于兼容原来的 Protocol.Debugger.XxxEvent 用法
type ScriptParsedEvent = Protocol.ScriptParsedEvent;
type PausedEvent = Protocol.PausedEvent;
type SetBreakpointByUrlRequest = Protocol.SetBreakpointByUrlRequest;

export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  hash: string;
  sourceMapURL?: string;
}

interface ScriptSourceCacheEntry {
  raw: string;
  beautified?: string;
}

export interface BreakpointInfo {
  breakpointId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  condition?: string;
  locations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  }>;
}

export interface SearchMatch {
  scriptId: string;
  url: string;
  lineNumber: number;
  lineContent: string;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  url: string;
  scopeChain: ScopeInfo[];
  this: RemoteObject;
}

export interface ScopeInfo {
  type:
    | 'global'
    | 'local'
    | 'with'
    | 'closure'
    | 'catch'
    | 'block'
    | 'script'
    | 'eval'
    | 'module'
    | 'wasm-expression-stack';
  object: RemoteObject;
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
}

export interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

export interface PausedState {
  isPaused: boolean;
  reason?: string;
  callFrames: CallFrame[];
  data?: unknown;
  hitBreakpoints?: string[];
}

export interface ScopeVariable {
  name: string;
  type: string;
  value: unknown;
  description?: string;
}

export interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: {
    text: string;
    exception?: RemoteObject;
  };
}

export interface AutoRecoveryEvent {
  breakpointId: string;
  signature: string;
  hitCount: number;
  timestamp: number;
  actions: string[];
  error?: string;
}

interface ExecutionContextCreatedEvent {
  context: RawExecutionContextDescription;
}

interface ExecutionContextDestroyedEvent {
  executionContextId: number;
}

/**
 * DebuggerContext manages the Chrome DevTools Protocol Debugger domain.
 * It tracks loaded scripts, manages breakpoints, and provides search functionality.
 */
export class DebuggerContext {
  #client: CDPSession | null = null;
  #scripts = new Map<string, ScriptInfo>(); // scriptId -> info
  #urlToScripts = new Map<string, string[]>(); // url -> scriptId[]
  #scriptSourceCache = new Map<string, ScriptSourceCacheEntry>(); // scriptId -> {raw, beautified?}
  #breakpoints = new Map<string, BreakpointInfo>(); // breakpointId -> info
  #executionContexts = new Map<number, ExecutionContextInfo>(); // contextId -> info
  #enabled = false;
  #pausedState: PausedState = {isPaused: false, callFrames: []};
  #breakpointHitWindowMs = 2000;
  #breakpointHitThreshold = 3;
  #breakpointLoopTracker = new Map<
    string,
    {breakpointId: string; count: number; firstHitAt: number; lastHitAt: number}
  >();
  #lastAutoRecoveryEvent: AutoRecoveryEvent | null = null;

  /**
   * Enable the debugger and start tracking scripts.
   */
  async enable(client: CDPSession): Promise<void> {
    if (this.#enabled && this.#client === client) {
      return;
    }

    this.#client = client;
    this.#scripts.clear();
    this.#urlToScripts.clear();
    this.#executionContexts.clear();

    // Listen for script parsed events
    client.on('Debugger.scriptParsed', this.#onScriptParsed);

    // Listen for paused/resumed events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('Debugger.paused', this.#onPaused as any);
    client.on('Debugger.resumed', this.#onResumed);
    client.on(
      'Runtime.executionContextCreated',
      this.#onExecutionContextCreated,
    );
    client.on(
      'Runtime.executionContextDestroyed',
      this.#onExecutionContextDestroyed,
    );
    client.on(
      'Runtime.executionContextsCleared',
      this.#onExecutionContextsCleared,
    );

    // Enable the debugger domain
    await client.send('Debugger.enable');
    await client.send('Runtime.enable');

    // Set async call stack depth for better stack traces
    try {
      await client.send('Debugger.setAsyncCallStackDepth', {maxDepth: 32});
    } catch {
      // Ignore errors - some older versions may not support this
    }

    this.#enabled = true;
  }

  /**
   * Disable the debugger.
   */
  async disable(): Promise<void> {
    if (!this.#enabled || !this.#client) {
      return;
    }

    this.#client.off('Debugger.scriptParsed', this.#onScriptParsed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.#client.off('Debugger.paused', this.#onPaused as any);
    this.#client.off('Debugger.resumed', this.#onResumed);
    this.#client.off(
      'Runtime.executionContextCreated',
      this.#onExecutionContextCreated,
    );
    this.#client.off(
      'Runtime.executionContextDestroyed',
      this.#onExecutionContextDestroyed,
    );
    this.#client.off(
      'Runtime.executionContextsCleared',
      this.#onExecutionContextsCleared,
    );

    try {
      await this.#client.send('Runtime.disable');
    } catch {
      // Ignore errors during cleanup
    }

    try {
      await this.#client.send('Debugger.disable');
    } catch {
      // Ignore errors during cleanup
    }

    this.#scripts.clear();
    this.#urlToScripts.clear();
    this.#scriptSourceCache.clear();
    this.#executionContexts.clear();
    this.#pausedState = {isPaused: false, callFrames: []};
    this.#breakpointLoopTracker.clear();
    this.#lastAutoRecoveryEvent = null;
    this.#enabled = false;
    this.#client = null;
  }

  /**
   * Check if debugger is enabled.
   */
  isEnabled(): boolean {
    return this.#enabled;
  }

  /**
   * Get the CDP client.
   */
  getClient(): CDPSession | null {
    return this.#client;
  }

  #onScriptParsed = (event: ScriptParsedEvent): void => {
    const scriptInfo: ScriptInfo = {
      scriptId: event.scriptId,
      url: event.url || '',
      startLine: event.startLine,
      startColumn: event.startColumn,
      endLine: event.endLine,
      endColumn: event.endColumn,
      hash: event.hash,
      sourceMapURL: event.sourceMapURL,
    };

    this.#scripts.set(event.scriptId, scriptInfo);

    // Index by URL for quick lookup
    if (event.url) {
      const scriptIds = this.#urlToScripts.get(event.url) || [];
      if (!scriptIds.includes(event.scriptId)) {
        scriptIds.push(event.scriptId);
        this.#urlToScripts.set(event.url, scriptIds);
      }
    }
  };

  #onPaused = (event: PausedEvent): void => {
    const callFrames: CallFrame[] = (
      event.callFrames as unknown as Protocol.PausedCallFrame[]
    ).map(frame => ({
      callFrameId: frame.callFrameId,
      functionName: frame.functionName || '<anonymous>',
      location: {
        scriptId: frame.location.scriptId,
        lineNumber: frame.location.lineNumber,
        columnNumber: frame.location.columnNumber ?? 0,
      },
      url: frame.url || '',
      scopeChain: frame.scopeChain.map(scope => ({
        type: scope.type as ScopeInfo['type'],
        object: {
          type: scope.object.type,
          subtype: scope.object.subtype,
          className: scope.object.className,
          value: scope.object.value,
          description: scope.object.description,
          objectId: scope.object.objectId,
        },
        name: scope.name,
        startLocation: scope.startLocation
          ? {
              scriptId: scope.startLocation.scriptId,
              lineNumber: scope.startLocation.lineNumber,
              columnNumber: scope.startLocation.columnNumber ?? 0,
            }
          : undefined,
        endLocation: scope.endLocation
          ? {
              scriptId: scope.endLocation.scriptId,
              lineNumber: scope.endLocation.lineNumber,
              columnNumber: scope.endLocation.columnNumber ?? 0,
            }
          : undefined,
      })),
      this: {
        type: frame.this.type,
        subtype: frame.this.subtype,
        className: frame.this.className,
        value: frame.this.value,
        description: frame.this.description,
        objectId: frame.this.objectId,
      },
    }));

    this.#pausedState = {
      isPaused: true,
      reason: event.reason,
      callFrames,
      data: event.data,
      hitBreakpoints: event.hitBreakpoints,
    };

    void this.#handlePotentialBreakpointLoop(event);
  };

  #onResumed = (): void => {
    this.#pausedState = {isPaused: false, callFrames: []};
  };

  #onExecutionContextCreated = (event: ExecutionContextCreatedEvent): void => {
    this.#executionContexts.set(
      event.context.id,
      createExecutionContextInfo(event.context),
    );
  };

  #onExecutionContextDestroyed = (
    event: ExecutionContextDestroyedEvent,
  ): void => {
    this.#executionContexts.delete(event.executionContextId);
  };

  #onExecutionContextsCleared = (): void => {
    this.#executionContexts.clear();
  };

  // ==================== Paused State Management ====================

  /**
   * Check if execution is paused.
   */
  isPaused(): boolean {
    return this.#pausedState.isPaused;
  }

  /**
   * Get the current paused state.
   */
  getPausedState(): PausedState {
    return this.#pausedState;
  }

  getLastAutoRecoveryEvent(maxAgeMs = 30000): AutoRecoveryEvent | null {
    if (!this.#lastAutoRecoveryEvent) {
      return null;
    }
    if (Date.now() - this.#lastAutoRecoveryEvent.timestamp > maxAgeMs) {
      return null;
    }
    return this.#lastAutoRecoveryEvent;
  }

  /**
   * Resume execution.
   */
  async resume(): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }
    if (!this.#pausedState.isPaused) {
      throw new Error('Execution is not paused');
    }
    await this.#client.send('Debugger.resume');
  }

  /**
   * Pause execution.
   */
  async pause(): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }
    await this.#client.send('Debugger.pause');
  }

  /**
   * Step over the next statement.
   */
  async stepOver(): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }
    if (!this.#pausedState.isPaused) {
      throw new Error('Execution is not paused');
    }
    await this.#client.send('Debugger.stepOver');
  }

  /**
   * Step into the next function call.
   */
  async stepInto(): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }
    if (!this.#pausedState.isPaused) {
      throw new Error('Execution is not paused');
    }
    await this.#client.send('Debugger.stepInto');
  }

  /**
   * Step out of the current function.
   */
  async stepOut(): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }
    if (!this.#pausedState.isPaused) {
      throw new Error('Execution is not paused');
    }
    await this.#client.send('Debugger.stepOut');
  }

  /**
   * Get variables from a scope.
   */
  async getScopeVariables(objectId: string): Promise<ScopeVariable[]> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    const result = await this.#client.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    });

    const variables: ScopeVariable[] = [];

    for (const prop of result.result) {
      // Skip internal properties
      if (prop.name.startsWith('__') || prop.name === 'this') {
        continue;
      }

      const value = prop.value;
      if (!value) {
        continue;
      }

      variables.push({
        name: prop.name,
        type: value.type,
        value: value.value ?? value.description ?? `[${value.type}]`,
        description: value.description,
      });
    }

    return variables;
  }

  /**
   * Evaluate expression on a specific call frame.
   */
  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    options: {
      returnByValue?: boolean;
      generatePreview?: boolean;
    } = {},
  ): Promise<EvaluateResult> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }
    if (!this.#pausedState.isPaused) {
      throw new Error('Execution is not paused');
    }

    const result = await this.#client.send('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression,
      returnByValue: options.returnByValue ?? false,
      generatePreview: options.generatePreview ?? true,
    });

    return {
      result: {
        type: result.result.type,
        subtype: result.result.subtype,
        className: result.result.className,
        value: result.result.value,
        description: result.result.description,
        objectId: result.result.objectId,
      },
      exceptionDetails: result.exceptionDetails
        ? {
            text: result.exceptionDetails.text,
            exception: result.exceptionDetails.exception
              ? {
                  type: result.exceptionDetails.exception.type,
                  value: result.exceptionDetails.exception.value,
                  description: result.exceptionDetails.exception.description,
                }
              : undefined,
          }
        : undefined,
    };
  }

  // ==================== Script Management ====================

  /**
   * Get all loaded scripts.
   */
  getScripts(): ScriptInfo[] {
    return Array.from(this.#scripts.values());
  }

  /**
   * Get recorded execution contexts.
   */
  getExecutionContexts(): ExecutionContextInfo[] {
    return Array.from(this.#executionContexts.values());
  }

  /**
   * Get execution context by ID.
   */
  getExecutionContextById(contextId: number): ExecutionContextInfo | undefined {
    return this.#executionContexts.get(contextId);
  }

  /**
   * Get scripts by URL (exact match).
   */
  getScriptsByUrl(url: string): ScriptInfo[] {
    const scriptIds = this.#urlToScripts.get(url) || [];
    return scriptIds
      .map(id => this.#scripts.get(id))
      .filter((s): s is ScriptInfo => s !== undefined);
  }

  /**
   * Get scripts by URL pattern (partial match).
   */
  getScriptsByUrlPattern(pattern: string): ScriptInfo[] {
    const results: ScriptInfo[] = [];
    const lowerPattern = pattern.toLowerCase();

    for (const script of this.#scripts.values()) {
      if (script.url.toLowerCase().includes(lowerPattern)) {
        results.push(script);
      }
    }

    return results;
  }

  /**
   * Get script info by ID.
   */
  getScriptById(scriptId: string): ScriptInfo | undefined {
    return this.#scripts.get(scriptId);
  }

  /**
   * Get the source code of a script. CDP result is cached per scriptId — subsequent
   * calls return without a roundtrip. Scripts are immutable once parsed, so the cache
   * is invalidated only by `disable()`.
   */
  async getScriptSource(scriptId: string): Promise<string> {
    const cached = this.#scriptSourceCache.get(scriptId);
    if (cached) {
      return cached.raw;
    }

    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    const result = await this.#client.send('Debugger.getScriptSource', {
      scriptId,
    });

    this.#scriptSourceCache.set(scriptId, {raw: result.scriptSource});
    return result.scriptSource;
  }

  /**
   * Get a beautified version of a script's source, computed lazily and cached.
   * The producer runs once per scriptId and the result is reused across calls;
   * if it throws, the original source is returned and not memoized.
   */
  async getBeautifiedScriptSource(
    scriptId: string,
    beautify: (source: string) => string,
  ): Promise<string> {
    const raw = await this.getScriptSource(scriptId);
    const cached = this.#scriptSourceCache.get(scriptId)!;
    if (cached.beautified !== undefined) {
      return cached.beautified;
    }
    try {
      const result = beautify(raw);
      cached.beautified = result;
      return result;
    } catch {
      return raw;
    }
  }

  /**
   * Search for a string in all scripts.
   */
  async searchInScripts(
    query: string,
    options: {
      caseSensitive?: boolean;
      isRegex?: boolean;
    } = {},
  ): Promise<SearchResult> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    const {caseSensitive = false, isRegex = false} = options;
    const matches: SearchMatch[] = [];

    // Search in each script
    for (const script of this.#scripts.values()) {
      // Skip scripts without URLs (inline scripts, eval, etc.)
      // unless they have meaningful content
      if (!script.url && !script.hash) {
        continue;
      }

      try {
        const result = await this.#client.send('Debugger.searchInContent', {
          scriptId: script.scriptId,
          query,
          caseSensitive,
          isRegex,
        });

        for (const match of result.result) {
          matches.push({
            scriptId: script.scriptId,
            url: script.url,
            lineNumber: match.lineNumber,
            lineContent: match.lineContent,
          });
        }
      } catch {
        // Skip scripts that can't be searched (e.g., wasm)
      }
    }

    return {query, matches};
  }

  // ==================== Breakpoint Management ====================

  /**
   * Set a breakpoint by URL.
   */
  async setBreakpoint(
    url: string,
    lineNumber: number,
    columnNumber = 0,
    condition?: string,
  ): Promise<BreakpointInfo> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    const params: SetBreakpointByUrlRequest = {
      url,
      lineNumber,
      columnNumber,
    };

    if (condition) {
      params.condition = condition;
    }

    const result = await this.#client.send(
      'Debugger.setBreakpointByUrl',
      params,
    );

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      url,
      lineNumber,
      columnNumber,
      condition,
      locations: result.locations.map(loc => ({
        scriptId: loc.scriptId,
        lineNumber: loc.lineNumber,
        columnNumber: loc.columnNumber ?? 0,
      })),
    };

    this.#breakpoints.set(result.breakpointId, breakpointInfo);

    return breakpointInfo;
  }

  /**
   * Set a breakpoint by URL regex pattern.
   */
  async setBreakpointByUrlRegex(
    urlRegex: string,
    lineNumber: number,
    columnNumber = 0,
    condition?: string,
  ): Promise<BreakpointInfo> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    const params = {
      urlRegex,
      lineNumber,
      columnNumber,
    } as unknown as SetBreakpointByUrlRequest;

    if (condition) {
      params.condition = condition;
    }

    const result = await this.#client.send(
      'Debugger.setBreakpointByUrl',
      params,
    );

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      url: urlRegex, // Store the regex as the URL
      lineNumber,
      columnNumber,
      condition,
      locations: result.locations.map(loc => ({
        scriptId: loc.scriptId,
        lineNumber: loc.lineNumber,
        columnNumber: loc.columnNumber ?? 0,
      })),
    };

    this.#breakpoints.set(result.breakpointId, breakpointInfo);

    return breakpointInfo;
  }

  /**
   * Remove a breakpoint.
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    await this.#client.send('Debugger.removeBreakpoint', {breakpointId});
    this.#breakpoints.delete(breakpointId);
  }

  /**
   * Remove all breakpoints.
   */
  async removeAllBreakpoints(): Promise<void> {
    if (!this.#client) {
      throw new Error('Debugger not enabled');
    }

    const breakpointIds = Array.from(this.#breakpoints.keys());
    for (const breakpointId of breakpointIds) {
      try {
        await this.removeBreakpoint(breakpointId);
      } catch {
        // Ignore errors for individual breakpoints
      }
    }
  }

  /**
   * Get all active breakpoints.
   */
  getBreakpoints(): BreakpointInfo[] {
    return Array.from(this.#breakpoints.values());
  }

  /**
   * Get breakpoint by ID.
   */
  getBreakpointById(breakpointId: string): BreakpointInfo | undefined {
    return this.#breakpoints.get(breakpointId);
  }

  async #handlePotentialBreakpointLoop(event: PausedEvent): Promise<void> {
    const breakpointId = event.hitBreakpoints?.[0];
    if (!breakpointId) {
      return;
    }

    const loc = event.callFrames?.[0]?.location;
    const signature = `${breakpointId}|${loc?.scriptId ?? 'unknown'}:${loc?.lineNumber ?? -1}:${loc?.columnNumber ?? -1}`;
    const now = Date.now();
    const tracked = this.#breakpointLoopTracker.get(signature);

    if (!tracked || now - tracked.firstHitAt > this.#breakpointHitWindowMs) {
      this.#breakpointLoopTracker.set(signature, {
        breakpointId,
        count: 1,
        firstHitAt: now,
        lastHitAt: now,
      });
      return;
    }

    tracked.count += 1;
    tracked.lastHitAt = now;

    if (tracked.count < this.#breakpointHitThreshold || !this.#client) {
      return;
    }

    const actions: string[] = [];
    let error: string | undefined;

    try {
      if (this.#pausedState.isPaused) {
        await this.#client.send('Debugger.resume');
        actions.push('resume');
      }
    } catch (e) {
      error = `resume failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    try {
      await this.removeBreakpoint(breakpointId);
      actions.push('remove_breakpoint');
    } catch (e) {
      const detail = `removeBreakpoint failed: ${e instanceof Error ? e.message : String(e)}`;
      error = error ? `${error}; ${detail}` : detail;
    }

    this.#lastAutoRecoveryEvent = {
      breakpointId,
      signature,
      hitCount: tracked.count,
      timestamp: Date.now(),
      actions,
      error,
    };

    this.#breakpointLoopTracker.delete(signature);
  }
}
