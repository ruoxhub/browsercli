/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DebuggerManager - 调试器门面（Facade）
 *
 * Phase 3 god-class 拆分后只保留 CDP session 生命周期 + sub-manager 协调 +
 * Debugger.paused 事件协调（handlePaused 同时涉及断点 hitCount 与 pausedState）。
 * 实际逻辑由 BreakpointManager / ExecutionController / ScopeInspector /
 * DebuggerSessionStore 4 个策略模块承担。公共 API 向后兼容。
 */

import type {CDPSession} from '../../third_party/index.js';
import type {
  BreakpointHitCallback,
  BreakpointHitEvent,
  DebuggerSession,
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
  ScopeVariable,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {resolveDefaultDebuggerSessionsDir} from '../../utils/projectPaths.js';
import type {CodeCollector} from '../collector/CodeCollector.js';

import {BlackboxManager} from './BlackboxManager.js';
import {BreakpointManager} from './BreakpointManager.js';
import {DebuggerSessionStore} from './DebuggerSessionStore.js';
import {EventBreakpointManager} from './EventBreakpointManager.js';
import {ExecutionController} from './ExecutionController.js';
import type {RuntimeInspector} from './RuntimeInspector.js';
import {ScopeInspector} from './ScopeInspector.js';
import {WatchExpressionManager} from './WatchExpressionManager.js';
import {XHRBreakpointManager} from './XHRBreakpointManager.js';

// 重新导出共享类型，保持向后兼容（AIContinuousDebugger / RuntimeInspector 等仍从此处导入）
export type {
  BreakpointInfo,
  CallFrame,
  DebuggerBreakpointResolvedEvent,
  DebuggerPausedEvent,
  PausedState,
  Scope,
} from './types.js';
import type {DebuggerPausedEvent, PausedState, Scope} from './types.js';

export class DebuggerManager {
  private cdpSession: CDPSession | null = null;
  private enabled = false;

  private _watchManager: WatchExpressionManager | null = null;
  private _xhrManager: XHRBreakpointManager | null = null;
  private _eventManager: EventBreakpointManager | null = null;
  private _blackboxManager: BlackboxManager | null = null;
  private pausedListener: ((params: DebuggerPausedEvent) => void) | null = null;

  private readonly breakpointManager: BreakpointManager;
  private readonly executionController: ExecutionController;
  private readonly scopeInspector: ScopeInspector;
  private readonly sessionStore: DebuggerSessionStore;

  constructor(private collector: CodeCollector) {
    this.breakpointManager = new BreakpointManager(() => this.requireSession());
    this.executionController = new ExecutionController(() =>
      this.requireSession(),
    );
    this.scopeInspector = new ScopeInspector(
      () => this.requireSession(),
      () => this.executionController.getPausedState(),
    );
    this.sessionStore = new DebuggerSessionStore(
      () => this.breakpointManager,
      () => this.getDefaultSessionsDir(),
      () => this.enabled,
    );
  }

  private getDefaultSessionsDir(): string {
    return resolveDefaultDebuggerSessionsDir(import.meta.url);
  }

  private requireSession(): CDPSession {
    if (!this.cdpSession || !this.enabled) {
      throw new Error('Debugger not enabled. Call init() or enable() first.');
    }
    return this.cdpSession;
  }

  private requireSubManager<T>(manager: T | null, name: string): T {
    if (!manager) {
      throw new Error(
        `${name} not initialized. Call initAdvancedFeatures() first.`,
      );
    }
    return manager;
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

    // Debugger.paused 由 facade 统一监听（handlePaused 需协调多策略模块）
    this.pausedListener = params => this.handlePaused(params);
    this.cdpSession.on('Debugger.paused', this.pausedListener);

    // 其余 listener 委托给策略模块
    this.executionController.attachListeners(this.cdpSession);
    this.breakpointManager.attachListeners(this.cdpSession);

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

    const session = this.cdpSession;
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
        session.off('Debugger.paused', this.pausedListener);
        this.pausedListener = null;
      }
      this.executionController.detachListeners(session);
      this.breakpointManager.detachListeners(session);

      await session.send('Debugger.disable');
    } catch (error) {
      logger.error('Failed to disable debugger:', error);
    } finally {
      this.enabled = false;
      this.breakpointManager.clearAllState();
      this.executionController.clearState();

      try {
        await session.detach();
      } catch (e) {
        logger.warn('Failed to detach CDP session:', e);
      }
      this.cdpSession = null;

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

  // ==================== 断点管理（委托 BreakpointManager） ====================

  async setBreakpointByUrl(params: {
    url: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<import('./types.js').BreakpointInfo> {
    return this.breakpointManager.setBreakpointByUrl(params);
  }

  async setBreakpoint(params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<import('./types.js').BreakpointInfo> {
    return this.breakpointManager.setBreakpoint(params);
  }

  removeBreakpoint(breakpointId: string): Promise<void> {
    return this.breakpointManager.removeBreakpoint(breakpointId);
  }

  listBreakpoints(): import('./types.js').BreakpointInfo[] {
    return this.breakpointManager.listBreakpoints();
  }

  getBreakpoint(
    breakpointId: string,
  ): import('./types.js').BreakpointInfo | undefined {
    return this.breakpointManager.getBreakpoint(breakpointId);
  }

  clearAllBreakpoints(): Promise<void> {
    return this.breakpointManager.clearAllBreakpoints();
  }

  setPauseOnExceptions(state: 'none' | 'uncaught' | 'all'): Promise<void> {
    return this.breakpointManager.setPauseOnExceptions(state);
  }

  getPauseOnExceptionsState(): 'none' | 'uncaught' | 'all' {
    return this.breakpointManager.getPauseOnExceptionsState();
  }

  // ==================== 执行控制（委托 ExecutionController） ====================

  pause(): Promise<void> {
    return this.executionController.pause();
  }

  resume(): Promise<void> {
    return this.executionController.resume();
  }

  stepInto(): Promise<void> {
    return this.executionController.stepInto();
  }

  stepOver(): Promise<void> {
    return this.executionController.stepOver();
  }

  stepOut(): Promise<void> {
    return this.executionController.stepOut();
  }

  getPausedState(): PausedState | null {
    return this.executionController.getPausedState();
  }

  isPaused(): boolean {
    return this.executionController.isPaused();
  }

  async waitForPaused(timeout = 30000): Promise<PausedState> {
    return this.executionController.waitForPaused(timeout);
  }

  async evaluateOnCallFrame(params: {
    callFrameId: string;
    expression: string;
    returnByValue?: boolean;
  }): Promise<unknown> {
    return this.executionController.evaluateOnCallFrame(params);
  }

  // ==================== 作用域变量（委托 ScopeInspector） ====================

  async getScopeVariables(
    options: GetScopeVariablesOptions = {},
  ): Promise<GetScopeVariablesResult> {
    return this.scopeInspector.getScopeVariables(options);
  }

  /** 将 CDP Scope.type 转换为 ScopeVariable.scope 兼容的联合类型。 */
  toScopeVariableScopeType(scopeType: Scope['type']): ScopeVariable['scope'] {
    return this.scopeInspector.toScopeVariableScopeType(scopeType);
  }

  // ==================== 断点命中回调（委托 BreakpointManager） ====================

  onBreakpointHit(callback: BreakpointHitCallback): void {
    this.breakpointManager.onBreakpointHit(callback);
  }

  offBreakpointHit(callback: BreakpointHitCallback): void {
    this.breakpointManager.offBreakpointHit(callback);
  }

  clearBreakpointHitCallbacks(): void {
    this.breakpointManager.clearBreakpointHitCallbacks();
  }

  getBreakpointHitCallbackCount(): number {
    return this.breakpointManager.getBreakpointHitCallbackCount();
  }

  private async handlePaused(params: DebuggerPausedEvent): Promise<void> {
    // 1. ExecutionController 写入 pausedState + 解析 waitForPaused 等待者
    this.executionController.setPausedState(params);
    // 2. BreakpointManager 更新命中断点的 hitCount
    this.breakpointManager.incrementHitCounts(params.hitBreakpoints);
    // 3. 若有断点命中回调，异步预取变量并触发回调
    if (
      !params.hitBreakpoints?.length ||
      !this.breakpointManager.hasBreakpointHitCallbacks()
    ) {
      return;
    }
    const topFrame = params.callFrames[0];
    const firstBreakpointId = params.hitBreakpoints[0];
    if (!firstBreakpointId || !topFrame) return;

    (async () => {
      let variables: ScopeVariable[] | undefined;
      try {
        variables = (
          await this.scopeInspector.getScopeVariables({skipErrors: true})
        ).variables;
      } catch (error) {
        logger.debug(
          'Failed to auto-fetch variables for breakpoint hit callback:',
          error,
        );
      }
      const event: BreakpointHitEvent = {
        breakpointId: firstBreakpointId,
        breakpointInfo:
          this.breakpointManager.getBreakpointInfo(firstBreakpointId),
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
      await this.breakpointManager.notifyBreakpointHitCallbacks(event);
    })().catch(error => {
      logger.error('Breakpoint hit callback pipeline error:', error);
    });
  }

  // ==================== 调试会话保存/恢复（委托 DebuggerSessionStore） ====================

  exportSession(metadata?: DebuggerSession['metadata']): DebuggerSession {
    return this.sessionStore.exportSession(metadata);
  }

  async saveSession(
    filePath?: string,
    metadata?: DebuggerSession['metadata'],
  ): Promise<string> {
    return this.sessionStore.saveSession(filePath, metadata);
  }

  async loadSessionFromFile(filePath: string): Promise<void> {
    return this.sessionStore.loadSessionFromFile(filePath);
  }

  async importSession(sessionData: DebuggerSession | string): Promise<void> {
    return this.sessionStore.importSession(sessionData);
  }

  async listSavedSessions(): Promise<
    Array<{path: string; timestamp: number; metadata?: unknown}>
  > {
    return this.sessionStore.listSavedSessions();
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

    this.breakpointManager.clearBreakpointHitCallbacks();
    logger.info('Debugger manager closed');
  }
}
