/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BreakpointManager - 断点管理策略模块。
 *
 * 提取自 DebuggerManager.ts，负责：
 * 1. 断点的设置、删除、查询（URL 断点 + scriptId 断点）
 * 2. pause-on-exceptions 状态
 * 3. 断点命中回调注册与触发
 * 4. Debugger.breakpointResolved 事件监听
 *
 * 通过 `getCDPSession` 访问器获取 CDP session，避免与 facade 的 session
 * 生命周期耦合。listener 注册/注销由 attachListeners/detachListeners 暴露，
 * 供 facade 在 init/disable 时调用。
 */

import type {CDPSession} from '../../third_party/index.js';
import type {
  BreakpointHitCallback,
  BreakpointHitEvent,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import type {
  BreakLocation,
  BreakpointInfo,
  DebuggerBreakpointResolvedEvent,
  Location,
} from './types.js';

export class BreakpointManager {
  private breakpoints = new Map<string, BreakpointInfo>();
  private pauseOnExceptionsState: 'none' | 'uncaught' | 'all' = 'none';
  private breakpointHitCallbacks = new Set<BreakpointHitCallback>();
  private breakpointResolvedListener:
    | ((params: DebuggerBreakpointResolvedEvent) => void)
    | null = null;

  constructor(private getCDPSession: () => CDPSession) {}

  /** 注册 Debugger.breakpointResolved 监听器。 */
  attachListeners(session: CDPSession): void {
    this.breakpointResolvedListener = params =>
      this.handleBreakpointResolved(params);
    session.on('Debugger.breakpointResolved', this.breakpointResolvedListener);
  }

  /** 注销 Debugger.breakpointResolved 监听器。 */
  detachListeners(session: CDPSession): void {
    if (this.breakpointResolvedListener) {
      session.off(
        'Debugger.breakpointResolved',
        this.breakpointResolvedListener,
      );
      this.breakpointResolvedListener = null;
    }
  }

  /** 内部状态清空（不调用 CDP，用于 facade disable 时的最终清理）。 */
  clearAllState(): void {
    this.breakpoints.clear();
    this.breakpointHitCallbacks.clear();
    this.pauseOnExceptionsState = 'none';
  }

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

    const result = await this.getCDPSession().send(
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

  async setBreakpointByUrlRegex(params: {
    urlRegex: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    if (!params.urlRegex) {
      throw new Error('urlRegex parameter is required');
    }
    if (params.lineNumber < 0) {
      throw new Error('lineNumber must be a non-negative number');
    }
    if (params.columnNumber !== undefined && params.columnNumber < 0) {
      throw new Error('columnNumber must be a non-negative number');
    }

    const result = await this.getCDPSession().send(
      'Debugger.setBreakpointByUrl',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        urlRegex: params.urlRegex,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
        condition: params.condition,
      } as any,
    );

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      location: {
        url: params.urlRegex,
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
      `Breakpoint set (regex): ${params.urlRegex}:${params.lineNumber}`,
      {breakpointId: result.breakpointId, condition: params.condition},
    );

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

    const result = await this.getCDPSession().send('Debugger.setBreakpoint', {
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

  async setBreakpointOnFunctionCall(
    objectId: string,
    condition?: string,
  ): Promise<BreakpointInfo> {
    if (!objectId) {
      throw new Error('objectId parameter is required');
    }

    const params: {objectId: string; condition?: string} = {objectId};
    if (condition !== undefined) {
      params.condition = condition;
    }

    const result = await this.getCDPSession().send(
      'Debugger.setBreakpointOnFunctionCall',
      params,
    );

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      location: {lineNumber: -1},
      condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };

    this.breakpoints.set(result.breakpointId, breakpointInfo);
    logger.info(`Breakpoint set on function call: ${objectId}`, {
      breakpointId: result.breakpointId,
    });

    return breakpointInfo;
  }

  async getPossibleBreakpoints(
    start: Location,
    end?: Location,
    restrictToFunction?: boolean,
  ): Promise<BreakLocation[]> {
    if (!start.scriptId) {
      throw new Error('start.scriptId is required');
    }

    const params: {start: Location; end?: Location; restrictToFunction?: boolean} = {
      start,
    };
    if (end) {
      params.end = end;
    }
    if (restrictToFunction !== undefined) {
      params.restrictToFunction = restrictToFunction;
    }

    const result = await this.getCDPSession().send(
      'Debugger.getPossibleBreakpoints',
      params,
    );

    return (result.locations ?? []) as BreakLocation[];
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

    await this.getCDPSession().send('Debugger.removeBreakpoint', {
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
    await this.getCDPSession().send('Debugger.setPauseOnExceptions', {state});
    this.pauseOnExceptionsState = state;
    logger.info(`Pause on exceptions set to: ${state}`);
  }

  getPauseOnExceptionsState(): 'none' | 'uncaught' | 'all' {
    return this.pauseOnExceptionsState;
  }

  // ==================== 断点命中回调 ====================

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

  /**
   * 在 Debugger.paused 事件中更新命中断点的 hitCount。
   * 由 facade 的 handlePaused 协调器调用。
   */
  incrementHitCounts(hitBreakpoints?: string[]): void {
    if (!hitBreakpoints) return;
    for (const breakpointId of hitBreakpoints) {
      const bp = this.breakpoints.get(breakpointId);
      if (bp) {
        bp.hitCount++;
      }
    }
  }

  /**
   * 触发断点命中回调（异步、不阻塞）。
   * 由 facade 的 handlePaused 协调器调用，传入构造好的事件。
   */
  async notifyBreakpointHitCallbacks(event: BreakpointHitEvent): Promise<void> {
    if (this.breakpointHitCallbacks.size === 0) return;

    const callbacks = Array.from(this.breakpointHitCallbacks);
    for (const callback of callbacks) {
      try {
        await Promise.resolve(callback(event));
      } catch (error) {
        logger.error('Breakpoint hit callback error:', error);
      }
    }
  }

  /** 暴露给 DebuggerSessionStore 用于导出。 */
  getBreakpointsForExport(): Array<{
    location: BreakpointInfo['location'];
    condition?: string;
    enabled: boolean;
  }> {
    return Array.from(this.breakpoints.values()).map(bp => ({
      location: {
        scriptId: bp.location.scriptId,
        url: bp.location.url,
        lineNumber: bp.location.lineNumber,
        columnNumber: bp.location.columnNumber,
      },
      condition: bp.condition,
      enabled: bp.enabled,
    }));
  }

  /** 暴露给 facade 用于在 handlePaused 中构造 BreakpointHitEvent。 */
  getBreakpointInfo(breakpointId: string): BreakpointInfo | undefined {
    return this.breakpoints.get(breakpointId);
  }

  /** 暴露给 facade 用于在 handlePaused 中预取变量。 */
  hasBreakpointHitCallbacks(): boolean {
    return this.breakpointHitCallbacks.size > 0;
  }

  private handleBreakpointResolved(
    params: DebuggerBreakpointResolvedEvent,
  ): void {
    const bp = this.breakpoints.get(params.breakpointId);
    if (bp) {
      const loc = params.location as {scriptId?: string; lineNumber?: number; columnNumber?: number} | undefined;
      if (loc) {
        bp.location = {
          scriptId: loc.scriptId ?? bp.location.scriptId,
          url: bp.location.url,
          lineNumber: loc.lineNumber ?? bp.location.lineNumber,
          columnNumber: loc.columnNumber ?? bp.location.columnNumber,
        };
      }
      logger.info('Breakpoint resolved', {
        breakpointId: params.breakpointId,
        location: bp.location,
      });
    }
  }
}
