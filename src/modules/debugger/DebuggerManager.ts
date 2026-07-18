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
import type {Page} from '../../third_party/index.js';
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

/**
 * DebuggerManager 仅依赖 CodeCollector.getActivePage（用于自建 CDP session 的
 * init() 路径）。当外部已持有 CDPSession 时（如 DebuggerContextProvider 走
 * enable(client) 分支），无需完整 CodeCollector，只需提供该最小协议即可，
 * 避免用 `as CodeCollector` 伪造依赖。
 */
export type DebuggerCollector = Pick<CodeCollector, 'getActivePage'>;

/** 兼容旧名：兼容 {getActivePage(): Promise<Page>} 的最小实现。 */
export interface MinimalDebuggerCollector {
  getActivePage(): Promise<Page>;
}

import {BlackboxManager} from './BlackboxManager.js';
import {BreakpointManager} from './BreakpointManager.js';
import {DebuggerSessionStore} from './DebuggerSessionStore.js';
import {EventBreakpointManager} from './EventBreakpointManager.js';
import type {ExecutionContextInfo} from './ExecutionContextInfo.js';
import {ExecutionContextTracker} from './ExecutionContextTracker.js';
import {ExecutionController} from './ExecutionController.js';
import type {RuntimeInspector} from './RuntimeInspector.js';
import {ScopeInspector} from './ScopeInspector.js';
import type {ScriptInfo} from './ScriptManager.js';
import {ScriptManager} from './ScriptManager.js';
import type {
  AutoRecoveryEvent,
  BreakpointInfo,
  BreakLocation,
  CallArgument,
  DebuggerPausedEvent,
  Location,
  PausedState,
  Scope,
  ScriptPosition,
} from './types.js';
import {WatchExpressionManager} from './WatchExpressionManager.js';
import {XHRBreakpointManager} from './XHRBreakpointManager.js';

// 重新导出共享类型，保持向后兼容（AIContinuousDebugger / RuntimeInspector 等仍从此处导入）
export type {
  AutoRecoveryEvent,
  BreakLocation,
  BreakpointInfo,
  CallArgument,
  CallFrame,
  DebuggerBreakpointResolvedEvent,
  DebuggerPausedEvent,
  Location,
  PausedState,
  Scope,
  ScriptPosition,
} from './types.js';

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
  private readonly scriptManager: ScriptManager;
  private readonly executionContextTracker: ExecutionContextTracker;

  // 断点循环自动恢复
  private readonly breakpointHitWindowMs = 2000;
  private readonly breakpointHitThreshold = 3;
  private breakpointLoopTracker = new Map<
    string,
    {breakpointId: string; count: number; firstHitAt: number; lastHitAt: number}
  >();
  #lastAutoRecoveryEvent: AutoRecoveryEvent | null = null;

  constructor(private collector: MinimalDebuggerCollector) {
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
      () => this._watchManager,
    );
    this.scriptManager = new ScriptManager(() => this.requireSession());
    this.executionContextTracker = new ExecutionContextTracker();
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
    await this.cdpSession.send('Runtime.enable');
    this.enabled = true;

    // Debugger.paused 由 facade 统一监听（handlePaused 需协调多策略模块）
    this.pausedListener = params => this.handlePaused(params);
    this.cdpSession.on('Debugger.paused', this.pausedListener);

    // 其余 listener 委托给策略模块
    this.executionController.attachListeners(this.cdpSession);
    this.breakpointManager.attachListeners(this.cdpSession);
    this.scriptManager.attachListeners(this.cdpSession);
    this.executionContextTracker.attachListeners(this.cdpSession);

    logger.info('Debugger enabled successfully');
  }

  /** enable 是 init 的别名,与其他模块保持一致 */
  async enable(client?: CDPSession): Promise<void> {
    if (client) {
      if (this.enabled) {
        logger.warn('Debugger already enabled');
        return;
      }

      this.cdpSession = client;
      await this.cdpSession.send('Debugger.enable');
      await this.cdpSession.send('Runtime.enable');
      this.enabled = true;

      this.pausedListener = params => this.handlePaused(params);
      this.cdpSession.on('Debugger.paused', this.pausedListener);

      this.executionController.attachListeners(this.cdpSession);
      this.breakpointManager.attachListeners(this.cdpSession);
      this.scriptManager.attachListeners(this.cdpSession);
      this.executionContextTracker.attachListeners(this.cdpSession);

      logger.info('Debugger enabled successfully (external CDP session)');
      return;
    }
    return this.init();
  }

  async initAdvancedFeatures(
    runtimeInspector?: RuntimeInspector,
  ): Promise<void> {
    this.requireSession();

    if (runtimeInspector) {
      this._watchManager = new WatchExpressionManager(runtimeInspector);
      logger.info('WatchExpressionManager initialized');
    }

    this._xhrManager = new XHRBreakpointManager(() => this.requireSession());
    logger.info('XHRBreakpointManager initialized');

    this._eventManager = new EventBreakpointManager(() =>
      this.requireSession(),
    );
    logger.info('EventBreakpointManager initialized');

    this._blackboxManager = new BlackboxManager(() => this.requireSession());
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
      this.scriptManager.detachListeners(session);
      this.scriptManager.clear();
      this.executionContextTracker.detachListeners(session);

      try {
        await session.send('Runtime.disable');
      } catch {
        // Ignore errors during cleanup
      }

      await session.send('Debugger.disable');
    } catch (error) {
      logger.error('Failed to disable debugger:', error);
    } finally {
      this.enabled = false;
      this.breakpointManager.clearAllState();
      this.executionController.clearState();
      this.executionContextTracker.clearState();
      this.breakpointLoopTracker.clear();
      this.#lastAutoRecoveryEvent = null;

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
  }): Promise<BreakpointInfo> {
    return this.breakpointManager.setBreakpointByUrl(params);
  }

  async setBreakpointByUrlRegex(params: {
    urlRegex: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    return this.breakpointManager.setBreakpointByUrlRegex(params);
  }

  async setBreakpoint(params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    return this.breakpointManager.setBreakpoint(params);
  }

  removeBreakpoint(breakpointId: string): Promise<void> {
    return this.breakpointManager.removeBreakpoint(breakpointId);
  }

  listBreakpoints(): BreakpointInfo[] {
    return this.breakpointManager.listBreakpoints();
  }

  getBreakpoint(breakpointId: string): BreakpointInfo | undefined {
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

  async setBreakpointOnFunctionCall(
    objectId: string,
    condition?: string,
  ): Promise<BreakpointInfo> {
    return this.breakpointManager.setBreakpointOnFunctionCall(
      objectId,
      condition,
    );
  }

  async getPossibleBreakpoints(
    start: Location,
    end?: Location,
    restrictToFunction?: boolean,
  ): Promise<BreakLocation[]> {
    return this.breakpointManager.getPossibleBreakpoints(
      start,
      end,
      restrictToFunction,
    );
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
    generatePreview?: boolean;
  }): Promise<{
    result: {
      type: string;
      subtype?: string;
      className?: string;
      value?: unknown;
      description?: string;
      objectId?: string;
    };
    exceptionDetails?: {
      text: string;
      exception?: {
        type?: string;
        value?: unknown;
        description?: string;
      };
    };
  }> {
    return this.executionController.evaluateOnCallFrame(params);
  }

  async continueToLocation(
    location: Location,
    targetCallFrames?: 'any' | 'current',
  ): Promise<void> {
    return this.executionController.continueToLocation(
      location,
      targetCallFrames,
    );
  }

  async setVariableValue(
    callFrameId: string,
    scopeNumber: number,
    variableName: string,
    newValue: CallArgument,
  ): Promise<void> {
    return this.executionController.setVariableValue(
      callFrameId,
      scopeNumber,
      variableName,
      newValue,
    );
  }

  async restartFrame(callFrameId: string): Promise<void> {
    return this.executionController.restartFrame(callFrameId);
  }

  async setReturnValue(newValue: CallArgument): Promise<void> {
    return this.executionController.setReturnValue(newValue);
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

  /** 低层级 API：直接获取指定 objectId 的变量列表（兼容 DebuggerContext.getScopeVariables）。 */
  async getScopeVariablesForObjectId(
    objectId: string,
  ): Promise<ScopeVariable[]> {
    return this.scopeInspector.getScopeVariablesForObjectId(objectId);
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

    // XHR breakpoint hitCount
    if (params.reason === 'XHR' && this._xhrManager) {
      const data = params.data as {url?: string} | undefined;
      if (data?.url) {
        for (const bp of this._xhrManager.getAllXHRBreakpoints()) {
          if (data.url.includes(bp.urlPattern)) {
            this._xhrManager.incrementHitCount(bp.id);
          }
        }
      }
    }

    // Event breakpoint hitCount
    if (params.reason === 'EventListener' && this._eventManager) {
      const data = params.data as {eventName?: string} | undefined;
      if (data?.eventName) {
        for (const bp of this._eventManager.getAllEventBreakpoints()) {
          if (bp.eventName === data.eventName) {
            this._eventManager.incrementHitCount(bp.id);
          }
        }
      }
    }

    // 3. 断点循环自动恢复检测
    void this.#handlePotentialBreakpointLoop(params);
    // 4. 若有断点命中回调，异步预取变量并触发回调
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

  async #handlePotentialBreakpointLoop(
    event: DebuggerPausedEvent,
  ): Promise<void> {
    const breakpointId = event.hitBreakpoints?.[0];
    if (!breakpointId) {
      return;
    }

    const loc = event.callFrames?.[0]?.location;
    const signature = `${breakpointId}|${loc?.scriptId ?? 'unknown'}:${loc?.lineNumber ?? -1}:${loc?.columnNumber ?? -1}`;
    const now = Date.now();
    const tracked = this.breakpointLoopTracker.get(signature);

    if (!tracked || now - tracked.firstHitAt > this.breakpointHitWindowMs) {
      this.breakpointLoopTracker.set(signature, {
        breakpointId,
        count: 1,
        firstHitAt: now,
        lastHitAt: now,
      });
      return;
    }

    tracked.count += 1;
    tracked.lastHitAt = now;

    if (tracked.count < this.breakpointHitThreshold || !this.cdpSession) {
      return;
    }

    const actions: string[] = [];
    let error: string | undefined;

    try {
      if (this.executionController.isPaused()) {
        await this.cdpSession.send('Debugger.resume');
        actions.push('resume');
      }
    } catch (e) {
      error = `resume failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    try {
      await this.breakpointManager.removeBreakpoint(breakpointId);
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

    this.breakpointLoopTracker.delete(signature);
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

  async mergeSession(sessionData: DebuggerSession | string): Promise<void> {
    return this.sessionStore.mergeSession(sessionData);
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

  // ==================== 脚本管理（委托 ScriptManager） ====================

  getScripts(): ScriptInfo[] {
    return this.scriptManager.getAllScriptsSync();
  }

  getScriptById(scriptId: string): ScriptInfo | undefined {
    return this.scriptManager.getScriptById(scriptId);
  }

  getScriptsByUrl(url: string): ScriptInfo[] {
    return this.scriptManager.getScriptsByUrl(url);
  }

  async getScriptsByUrlPattern(pattern: string): Promise<ScriptInfo[]> {
    return this.scriptManager.findScriptsByUrl(pattern);
  }

  async getScriptSource(scriptId: string): Promise<string> {
    const script = await this.scriptManager.getScriptSource(scriptId);
    if (!script) {
      throw new Error(`Script source not found: ${scriptId}`);
    }
    if (!script.sourcePath) {
      const loadError = (script as any).loadError;
      if (loadError) {
        throw new Error(
          `Failed to get script source for ${scriptId}: ${loadError.message || loadError}`,
        );
      }
      throw new Error(`Script source not found: ${scriptId}`);
    }
    const content = this.scriptManager.getScriptContent(scriptId);
    if (!content) {
      throw new Error(`Script source file missing: ${scriptId}`);
    }
    return content;
  }

  async getScriptSourcePath(
    scriptId: string,
    filePath?: string,
  ): Promise<string | null> {
    return this.scriptManager.getScriptSourcePath(scriptId, filePath);
  }

  async getBeautifiedScriptSource(
    scriptId: string,
    beautify: (source: string) => string,
  ): Promise<string> {
    return this.scriptManager.getBeautifiedScriptSource(scriptId, beautify);
  }

  async searchInScripts(
    query: string,
    options: {caseSensitive?: boolean; isRegex?: boolean} = {},
  ): Promise<{
    query: string;
    matches: Array<{
      scriptId: string;
      url: string;
      lineNumber: number;
      lineContent: string;
    }>;
  }> {
    const result = await this.scriptManager.searchInScripts(query, {
      caseSensitive: options.caseSensitive,
      isRegex: options.isRegex,
    });
    return {
      query: result.keyword,
      matches: result.matches.map(m => ({
        scriptId: m.scriptId,
        url: m.url,
        lineNumber: m.lineNumber,
        lineContent: m.lineContent,
      })),
    };
  }

  // ==================== 执行上下文（委托 ExecutionContextTracker） ====================

  getExecutionContexts(): ExecutionContextInfo[] {
    return this.executionContextTracker.getExecutionContexts();
  }

  getExecutionContextById(contextId: number): ExecutionContextInfo | undefined {
    return this.executionContextTracker.getExecutionContextById(contextId);
  }

  // ==================== 黑盒化范围（委托 BlackboxManager） ====================

  async setBlackboxedRanges(
    scriptId: string,
    positions: ScriptPosition[],
  ): Promise<void> {
    return this.getBlackboxManager().setBlackboxedRanges(scriptId, positions);
  }

  // ==================== 便捷访问器 ====================

  /** getClient 是 getCDPSession 的别名，用于兼容 DebuggerContext 的 API。 */
  getClient(): CDPSession | null {
    return this.cdpSession;
  }

  /** getBreakpoints 是 listBreakpoints 的别名，用于兼容 DebuggerContext 的 API。 */
  getBreakpoints(): BreakpointInfo[] {
    return this.breakpointManager.listBreakpoints();
  }
}
