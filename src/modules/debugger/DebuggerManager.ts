/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DebuggerManager - 调试器核心管理
 *
 * 功能:
 * 1. 断点管理(设置、删除、列出、条件断点)
 * 2. 执行控制(暂停、继续、单步执行)
 * 3. 调试状态管理(暂停状态、调用帧)
 *
 * 设计原则:
 * - 薄封装 CDP Debugger 域,直接调用 CDP API
 * - 依赖 CodeCollector 获取 CDP 会话
 * - 维护断点和暂停状态的映射
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {CDPSession} from '../../third_party/index.js';
import type {
  ScopeVariable,
  BreakpointHitCallback,
  BreakpointHitEvent,
  DebuggerSession,
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {resolveDefaultDebuggerSessionsDir} from '../../utils/projectPaths.js';
import type {CodeCollector} from '../collector/CodeCollector.js';


import {BlackboxManager} from './BlackboxManager.js';
import {EventBreakpointManager} from './EventBreakpointManager.js';
import type {RuntimeInspector} from './RuntimeInspector.js';
import {WatchExpressionManager} from './WatchExpressionManager.js';
import {XHRBreakpointManager} from './XHRBreakpointManager.js';

export interface BreakpointInfo {
  breakpointId: string;
  location: {
    scriptId?: string;
    url?: string;
    lineNumber: number;
    columnNumber?: number;
  };
  condition?: string;
  enabled: boolean;
  hitCount: number;
  createdAt: number;
}

export interface PausedState {
  callFrames: CallFrame[];
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
  timestamp: number;
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
  };
  url: string;
  scopeChain: Scope[];
  this: unknown;
}

export interface Scope {
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
  object: {
    type: string;
    objectId?: string;
    className?: string;
    description?: string;
  };
  name?: string;
  startLocation?: {scriptId: string; lineNumber: number; columnNumber?: number};
  endLocation?: {scriptId: string; lineNumber: number; columnNumber?: number};
}

interface DebuggerPausedEvent {
  callFrames: CallFrame[];
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
}

interface DebuggerBreakpointResolvedEvent {
  breakpointId: string;
  location?: unknown;
}

export class DebuggerManager {
  private cdpSession: CDPSession | null = null;
  private enabled = false;

  private breakpoints = new Map<string, BreakpointInfo>();
  private pausedState: PausedState | null = null;
  private pausedResolvers: Array<(state: PausedState) => void> = [];

  private breakpointHitCallbacks = new Set<BreakpointHitCallback>();
  private pauseOnExceptionsState: 'none' | 'uncaught' | 'all' = 'none';

  private _watchManager: WatchExpressionManager | null = null;
  private _xhrManager: XHRBreakpointManager | null = null;
  private _eventManager: EventBreakpointManager | null = null;
  private _blackboxManager: BlackboxManager | null = null;

  private pausedListener: ((params: DebuggerPausedEvent) => void) | null = null;
  private resumedListener: (() => void) | null = null;
  private breakpointResolvedListener:
    | ((params: DebuggerBreakpointResolvedEvent) => void)
    | null = null;

  constructor(private collector: CodeCollector) {}

  private getDefaultSessionsDir(): string {
    return resolveDefaultDebuggerSessionsDir(import.meta.url);
  }

  private requireSession(): CDPSession {
    if (!this.cdpSession || !this.enabled) {
      throw new Error(
        'Debugger not enabled. Call init() or enable() first.',
      );
    }
    return this.cdpSession;
  }

  private requireSubManager<T>(
    manager: T | null,
    name: string,
  ): T {
    if (!manager) {
      throw new Error(
        `${name} not initialized. Call initAdvancedFeatures() first.`,
      );
    }
    return manager;
  }

  /**
   * 将 CDP Scope.type 转换为 ScopeVariable.scope 兼容的联合类型。
   * wasm-expression-stack 等扩展类型会被规范化为 'block'。
   */
  private toScopeVariableScopeType(
    scopeType: Scope['type'],
  ): ScopeVariable['scope'] {
    const known: Array<ScopeVariable['scope']> = [
      'global',
      'local',
      'with',
      'closure',
      'catch',
      'block',
      'script',
      'eval',
      'module',
    ];
    return (known as readonly string[]).includes(scopeType)
      ? (scopeType as ScopeVariable['scope'])
      : 'block';
  }

  /** 获取共享的 CDP Session(供子管理器使用) */
  getCDPSession(): CDPSession {
    return this.requireSession();
  }

  getWatchManager(): WatchExpressionManager {
    return this.requireSubManager(this._watchManager, 'WatchExpressionManager');
  }

  getXHRManager(): XHRBreakpointManager {
    return this.requireSubManager(this._xhrManager, 'XHRBreakpointManager');
  }

  getEventManager(): EventBreakpointManager {
    return this.requireSubManager(this._eventManager, 'EventBreakpointManager');
  }

  getBlackboxManager(): BlackboxManager {
    return this.requireSubManager(this._blackboxManager, 'BlackboxManager');
  }

  async init(): Promise<void> {
    if (this.enabled) {
      logger.warn('Debugger already enabled');
      return;
    }

    const page = await this.collector.getActivePage();
    this.cdpSession = await page.context().newCDPSession(page);

    await this.cdpSession.send('Debugger.enable');
    this.enabled = true;

    this.pausedListener = params => this.handlePaused(params);
    this.resumedListener = () => this.handleResumed();
    this.breakpointResolvedListener = params =>
      this.handleBreakpointResolved(params);

    this.cdpSession.on('Debugger.paused', this.pausedListener);
    this.cdpSession.on('Debugger.resumed', this.resumedListener);
    this.cdpSession.on(
      'Debugger.breakpointResolved',
      this.breakpointResolvedListener,
    );

    logger.info('Debugger enabled successfully');
  }

  /** enable 是 init 的别名,与其他模块保持一致 */
  async enable(): Promise<void> {
    return this.init();
  }

  async initAdvancedFeatures(
    runtimeInspector?: RuntimeInspector,
  ): Promise<void> {
    const cdpSession = this.requireSession();

    if (runtimeInspector) {
      this._watchManager = new WatchExpressionManager(runtimeInspector);
      logger.info('WatchExpressionManager initialized');
    }

    this._xhrManager = new XHRBreakpointManager(cdpSession);
    logger.info('XHRBreakpointManager initialized');

    this._eventManager = new EventBreakpointManager(cdpSession);
    logger.info('EventBreakpointManager initialized');

    this._blackboxManager = new BlackboxManager(cdpSession);
    logger.info('BlackboxManager initialized');

    logger.info('All advanced debugging features initialized');
  }

  async disable(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      logger.warn('Debugger not enabled');
      return;
    }

    try {
      if (this._xhrManager) {
        await this._xhrManager.close();
        this._xhrManager = null;
      }
      if (this._eventManager) {
        await this._eventManager.close();
        this._eventManager = null;
      }
      if (this._blackboxManager) {
        await this._blackboxManager.close();
        this._blackboxManager = null;
      }
      if (this._watchManager) {
        this._watchManager.clearAll();
        this._watchManager = null;
      }

      if (this.pausedListener) {
        this.cdpSession.off('Debugger.paused', this.pausedListener);
        this.pausedListener = null;
      }
      if (this.resumedListener) {
        this.cdpSession.off('Debugger.resumed', this.resumedListener);
        this.resumedListener = null;
      }
      if (this.breakpointResolvedListener) {
        this.cdpSession.off(
          'Debugger.breakpointResolved',
          this.breakpointResolvedListener,
        );
        this.breakpointResolvedListener = null;
      }

      await this.cdpSession.send('Debugger.disable');
    } catch (error) {
      logger.error('Failed to disable debugger:', error);
    } finally {
      this.enabled = false;
      this.breakpoints.clear();
      this.pausedState = null;
      this.pausedResolvers = [];

      if (this.cdpSession) {
        try {
          await this.cdpSession.detach();
        } catch (e) {
          logger.warn('Failed to detach CDP session:', e);
        }
        this.cdpSession = null;
      }

      logger.info('Debugger disabled and cleaned up');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setAsyncCallStackDepth(maxDepth: number): Promise<void> {
    await this.requireSession().send('Debugger.setAsyncCallStackDepth', {
      maxDepth,
    });
  }

  // ==================== 断点管理 ====================

  async setBreakpointByUrl(params: {
    url: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    if (!params.url) {
      throw new Error('url parameter is required');
    }
    if (params.lineNumber < 0) {
      throw new Error('lineNumber must be a non-negative number');
    }
    if (params.columnNumber !== undefined && params.columnNumber < 0) {
      throw new Error('columnNumber must be a non-negative number');
    }

    const result = await this.requireSession().send(
      'Debugger.setBreakpointByUrl',
      {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
        condition: params.condition,
      },
    );

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      location: {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };

    this.breakpoints.set(result.breakpointId, breakpointInfo);

    logger.info(`Breakpoint set: ${params.url}:${params.lineNumber}`, {
      breakpointId: result.breakpointId,
      condition: params.condition,
    });

    return breakpointInfo;
  }

  async setBreakpoint(params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    if (!params.scriptId) {
      throw new Error('scriptId parameter is required');
    }
    if (params.lineNumber < 0) {
      throw new Error('lineNumber must be a non-negative number');
    }
    if (params.columnNumber !== undefined && params.columnNumber < 0) {
      throw new Error('columnNumber must be a non-negative number');
    }

    const result = await this.requireSession().send('Debugger.setBreakpoint', {
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
    });

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };

    this.breakpoints.set(result.breakpointId, breakpointInfo);

    logger.info(
      `Breakpoint set: scriptId=${params.scriptId}:${params.lineNumber}`,
      {breakpointId: result.breakpointId},
    );

    return breakpointInfo;
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!breakpointId) {
      throw new Error('breakpointId parameter is required');
    }
    if (!this.breakpoints.has(breakpointId)) {
      throw new Error(
        `Breakpoint not found: ${breakpointId}. Use listBreakpoints() to see active breakpoints.`,
      );
    }

    await this.requireSession().send('Debugger.removeBreakpoint', {
      breakpointId,
    });
    this.breakpoints.delete(breakpointId);

    logger.info(`Breakpoint removed: ${breakpointId}`);
  }

  listBreakpoints(): BreakpointInfo[] {
    return Array.from(this.breakpoints.values());
  }

  getBreakpoint(breakpointId: string): BreakpointInfo | undefined {
    return this.breakpoints.get(breakpointId);
  }

  async clearAllBreakpoints(): Promise<void> {
    const breakpointIds = Array.from(this.breakpoints.keys());
    for (const id of breakpointIds) {
      await this.removeBreakpoint(id);
    }
    logger.info(`Cleared ${breakpointIds.length} breakpoints`);
  }

  async setPauseOnExceptions(
    state: 'none' | 'uncaught' | 'all',
  ): Promise<void> {
    await this.requireSession().send('Debugger.setPauseOnExceptions', {state});
    this.pauseOnExceptionsState = state;
    logger.info(`Pause on exceptions set to: ${state}`);
  }

  getPauseOnExceptionsState(): 'none' | 'uncaught' | 'all' {
    return this.pauseOnExceptionsState;
  }

  // ==================== 执行控制 ====================

  async pause(): Promise<void> {
    await this.requireSession().send('Debugger.pause');
    logger.info('Execution paused');
  }

  async resume(): Promise<void> {
    await this.requireSession().send('Debugger.resume');
    logger.info('Execution resumed');
  }

  async stepInto(): Promise<void> {
    await this.requireSession().send('Debugger.stepInto');
    logger.info('Step into');
  }

  async stepOver(): Promise<void> {
    await this.requireSession().send('Debugger.stepOver');
    logger.info('Step over');
  }

  async stepOut(): Promise<void> {
    await this.requireSession().send('Debugger.stepOut');
    logger.info('Step out');
  }

  // ==================== 暂停状态管理 ====================

  getPausedState(): PausedState | null {
    return this.pausedState;
  }

  isPaused(): boolean {
    return this.pausedState !== null;
  }

  /** 等待暂停事件(用于异步等待断点触发) */
  async waitForPaused(timeout = 30000): Promise<PausedState> {
    if (this.pausedState) {
      return this.pausedState;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pausedResolvers.indexOf(resolve);
        if (index > -1) {
          this.pausedResolvers.splice(index, 1);
        }
        reject(new Error('Timeout waiting for paused event'));
      }, timeout);

      this.pausedResolvers.push(state => {
        clearTimeout(timer);
        resolve(state);
      });
    });
  }

  async evaluateOnCallFrame(params: {
    callFrameId: string;
    expression: string;
    returnByValue?: boolean;
  }): Promise<unknown> {
    if (!this.pausedState) {
      throw new Error('Not in paused state');
    }

    const result = await this.requireSession().send(
      'Debugger.evaluateOnCallFrame',
      {
        callFrameId: params.callFrameId,
        expression: params.expression,
        returnByValue: params.returnByValue !== false,
      },
    );

    logger.info(`Evaluated on call frame: ${params.expression}`, {
      result: result.result.value,
    });

    return result.result;
  }

  // ==================== 作用域变量获取 ====================

  async getScopeVariables(
    options: GetScopeVariablesOptions = {},
  ): Promise<GetScopeVariablesResult> {
    this.requireSession();

    if (!this.pausedState) {
      throw new Error(
        'Not in paused state. Use pause() or set a breakpoint first.',
      );
    }

    const {
      callFrameId,
      includeObjectProperties = false,
      maxDepth = 1,
      skipErrors = true,
    } = options;

    const targetFrame = callFrameId
      ? this.pausedState.callFrames.find(f => f.callFrameId === callFrameId)
      : this.pausedState.callFrames[0];

    if (!targetFrame) {
      throw new Error(`Call frame not found: ${callFrameId || 'top frame'}`);
    }

    const variables: ScopeVariable[] = [];
    const errors: Array<{scope: string; error: string}> = [];
    let successfulScopes = 0;

    for (const scope of targetFrame.scopeChain) {
      try {
        if (!scope.object.objectId) continue;

        const properties = await this.requireSession().send(
          'Runtime.getProperties',
          {objectId: scope.object.objectId, ownProperties: true},
        );

        for (const prop of properties.result) {
          if (prop.name === '__proto__') continue;

          const scopeType = this.toScopeVariableScopeType(scope.type);

          variables.push({
            name: prop.name,
            value: prop.value?.value,
            type: prop.value?.type || 'unknown',
            scope: scopeType,
            writable: prop.writable,
            configurable: prop.configurable,
            enumerable: prop.enumerable,
            objectId: prop.value?.objectId,
          });

          if (
            includeObjectProperties &&
            prop.value?.objectId &&
            maxDepth > 0
          ) {
            const nestedProps = await this.getObjectProperties(
              prop.value.objectId,
              maxDepth - 1,
            );
            for (const nested of nestedProps) {
              variables.push({
                ...nested,
                name: `${prop.name}.${nested.name}`,
                scope: scopeType,
              });
            }
          }
        }

        successfulScopes++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Failed to get properties for scope ${scope.type}:`,
          errorMsg,
        );
        errors.push({scope: scope.type, error: errorMsg});

        if (!skipErrors) {
          throw error;
        }
      }
    }

    const result: GetScopeVariablesResult = {
      success: true,
      variables,
      callFrameId: targetFrame.callFrameId,
      callFrameInfo: {
        functionName: targetFrame.functionName || '(anonymous)',
        location: `${targetFrame.url}:${targetFrame.location.lineNumber}:${targetFrame.location.columnNumber}`,
      },
      totalScopes: targetFrame.scopeChain.length,
      successfulScopes,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    logger.info(
      `Got ${variables.length} variables from ${successfulScopes}/${targetFrame.scopeChain.length} scopes`,
      {
        callFrameId: targetFrame.callFrameId,
        functionName: targetFrame.functionName,
        errors: errors.length,
      },
    );

    return result;
  }

  private async getObjectProperties(
    objectId: string,
    maxDepth: number,
  ): Promise<ScopeVariable[]> {
    const session = this.cdpSession;
    if (maxDepth <= 0 || !session) {
      return [];
    }

    try {
      const properties = await session.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
      });

      const variables: ScopeVariable[] = [];
      for (const prop of properties.result) {
        if (prop.name === '__proto__') continue;
        variables.push({
          name: prop.name,
          value: prop.value?.value,
          type: prop.value?.type || 'unknown',
          scope: 'local',
          objectId: prop.value?.objectId,
        });
      }
      return variables;
    } catch (error) {
      logger.debug(`Failed to get object properties for ${objectId}:`, error);
      return [];
    }
  }

  // ==================== 断点命中回调管理 ====================

  onBreakpointHit(callback: BreakpointHitCallback): void {
    this.breakpointHitCallbacks.add(callback);
    logger.info('Breakpoint hit callback registered', {
      totalCallbacks: this.breakpointHitCallbacks.size,
    });
  }

  offBreakpointHit(callback: BreakpointHitCallback): void {
    this.breakpointHitCallbacks.delete(callback);
    logger.info('Breakpoint hit callback removed', {
      totalCallbacks: this.breakpointHitCallbacks.size,
    });
  }

  clearBreakpointHitCallbacks(): void {
    this.breakpointHitCallbacks.clear();
    logger.info('All breakpoint hit callbacks cleared');
  }

  getBreakpointHitCallbackCount(): number {
    return this.breakpointHitCallbacks.size;
  }

  // ==================== 事件处理 ====================

  private async handlePaused(params: DebuggerPausedEvent): Promise<void> {
    this.pausedState = {
      callFrames: params.callFrames,
      reason: params.reason,
      data: params.data,
      hitBreakpoints: params.hitBreakpoints,
      timestamp: Date.now(),
    };

    if (params.hitBreakpoints) {
      for (const breakpointId of params.hitBreakpoints) {
        const bp = this.breakpoints.get(breakpointId);
        if (bp) {
          bp.hitCount++;
        }
      }
    }

    logger.info('Execution paused', {
      reason: params.reason,
      location: params.callFrames[0]?.location,
      hitBreakpoints: params.hitBreakpoints,
    });

    for (const resolver of this.pausedResolvers) {
      resolver(this.pausedState);
    }
    this.pausedResolvers = [];

    // 异步触发断点命中回调(不阻塞 paused 事件处理)
    if (
      params.hitBreakpoints &&
      params.hitBreakpoints.length > 0 &&
      this.breakpointHitCallbacks.size > 0
    ) {
      const callbacks = Array.from(this.breakpointHitCallbacks);
      const hitBreakpoints = params.hitBreakpoints;
      const topFrame = params.callFrames[0];

      (async () => {
        let variables: ScopeVariable[] | undefined;
        try {
          const result = await this.getScopeVariables({skipErrors: true});
          variables = result.variables;
        } catch (error) {
          logger.debug(
            'Failed to auto-fetch variables for breakpoint hit callback:',
            error,
          );
        }

        const firstBreakpointId = hitBreakpoints[0];
        if (!firstBreakpointId || !topFrame) return;

        const event: BreakpointHitEvent = {
          breakpointId: firstBreakpointId,
          breakpointInfo: this.breakpoints.get(firstBreakpointId),
          location: {
            scriptId: topFrame.location.scriptId,
            lineNumber: topFrame.location.lineNumber,
            columnNumber: topFrame.location.columnNumber,
            url: topFrame.url,
          },
          callFrames: params.callFrames,
          timestamp: Date.now(),
          variables,
          reason: params.reason,
        };

        for (const callback of callbacks) {
          try {
            await Promise.resolve(callback(event));
          } catch (error) {
            logger.error('Breakpoint hit callback error:', error);
          }
        }
      })().catch(error => {
        logger.error('Breakpoint hit callback pipeline error:', error);
      });
    }
  }

  private handleResumed(): void {
    this.pausedState = null;
    logger.info('Execution resumed');
  }

  private handleBreakpointResolved(params: DebuggerBreakpointResolvedEvent): void {
    const bp = this.breakpoints.get(params.breakpointId);
    if (bp) {
      logger.info('Breakpoint resolved', {
        breakpointId: params.breakpointId,
        location: params.location,
      });
    }
  }

  // ==================== 调试会话保存/恢复 ====================

  exportSession(metadata?: DebuggerSession['metadata']): DebuggerSession {
    const session: DebuggerSession = {
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: Array.from(this.breakpoints.values()).map(bp => ({
        location: {
          scriptId: bp.location.scriptId,
          url: bp.location.url,
          lineNumber: bp.location.lineNumber,
          columnNumber: bp.location.columnNumber,
        },
        condition: bp.condition,
        enabled: bp.enabled,
      })),
      pauseOnExceptions: this.pauseOnExceptionsState,
      metadata: metadata || {},
    };

    logger.info('Session exported', {
      breakpointCount: session.breakpoints.length,
      pauseOnExceptions: session.pauseOnExceptions,
    });

    return session;
  }

  async saveSession(
    filePath?: string,
    metadata?: DebuggerSession['metadata'],
  ): Promise<string> {
    const session = this.exportSession(metadata);

    if (!filePath) {
      const sessionsDir = this.getDefaultSessionsDir();
      await fs.mkdir(sessionsDir, {recursive: true});
      filePath = path.join(sessionsDir, `session-${Date.now()}.json`);
    } else {
      await fs.mkdir(path.dirname(filePath), {recursive: true});
    }

    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');

    logger.info(`Session saved to ${filePath}`, {
      breakpointCount: session.breakpoints.length,
    });

    return filePath;
  }

  async loadSessionFromFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const session: DebuggerSession = JSON.parse(content);
    await this.importSession(session);

    logger.info(`Session loaded from ${filePath}`, {
      breakpointCount: session.breakpoints.length,
    });
  }

  async importSession(sessionData: DebuggerSession | string): Promise<void> {
    if (!this.enabled) {
      throw new Error(
        'Debugger must be enabled before importing session. Call init() or enable() first.',
      );
    }

    const session: DebuggerSession =
      typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

    if (session.version !== '1.0') {
      logger.warn(
        `Session version mismatch: ${session.version} (expected 1.0)`,
      );
    }

    logger.info('Importing session...', {
      breakpointCount: session.breakpoints.length,
      pauseOnExceptions: session.pauseOnExceptions,
      timestamp: new Date(session.timestamp).toISOString(),
    });

    await this.clearAllBreakpoints();

    let successCount = 0;
    let failCount = 0;

    for (const bp of session.breakpoints) {
      try {
        if (bp.location.url) {
          await this.setBreakpointByUrl({
            url: bp.location.url,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
        } else if (bp.location.scriptId) {
          await this.setBreakpoint({
            scriptId: bp.location.scriptId,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
        } else {
          logger.warn('Breakpoint has neither url nor scriptId, skipping', bp);
          failCount++;
          continue;
        }
        successCount++;
      } catch (error) {
        logger.error('Failed to restore breakpoint:', error, bp);
        failCount++;
      }
    }

    if (session.pauseOnExceptions) {
      await this.setPauseOnExceptions(session.pauseOnExceptions);
    }

    logger.info('Session imported', {
      totalBreakpoints: session.breakpoints.length,
      successCount,
      failCount,
      pauseOnExceptions: session.pauseOnExceptions,
    });
  }

  async listSavedSessions(): Promise<
    Array<{path: string; timestamp: number; metadata?: unknown}>
  > {
    const sessionsDir = this.getDefaultSessionsDir();

    try {
      await fs.access(sessionsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(sessionsDir);
    const sessions: Array<{path: string; timestamp: number; metadata?: unknown}> =
      [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(sessionsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const session: DebuggerSession = JSON.parse(content);
        sessions.push({
          path: filePath,
          timestamp: session.timestamp,
          metadata: session.metadata,
        });
      } catch (error) {
        logger.warn(`Failed to read session file ${file}:`, error);
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);
    return sessions;
  }

  async close(): Promise<void> {
    if (this.enabled) {
      await this.disable();
    }

    if (this.cdpSession) {
      try {
        await this.cdpSession.detach();
      } catch (e) {
        logger.warn('Failed to detach CDP session in close():', e);
      }
      this.cdpSession = null;
    }

    this.breakpointHitCallbacks.clear();
    logger.info('Debugger manager closed');
  }
}
