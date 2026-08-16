/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ExecutionController - 执行控制策略模块。
 *
 * 提取自 DebuggerManager.ts，负责：
 * 1. 执行流程控制（pause / resume / stepInto / stepOver / stepOut）
 * 2. 暂停状态管理（getPausedState / isPaused / waitForPaused）
 * 3. 在调用帧上求值（evaluateOnCallFrame）
 * 4. Debugger.resumed 事件监听
 *
 * Debugger.paused 事件由 facade 统一监听并协调（handlePaused 同时涉及
 * 断点 hitCount 与 pausedState，放在 facade 里更清晰）——本模块仅提供
 * setPausedState 等供 facade 调用的状态写入接口。
 */

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';

import type {
  CallArgument,
  DebuggerPausedEvent,
  Location,
  PausedState,
} from './types.js';

export class ExecutionController {
  private pausedState: PausedState | null = null;
  private pausedResolvers: Array<(state: PausedState) => void> = [];
  private resumedListener: (() => void) | null = null;

  constructor(private getCDPSession: () => CDPSession) {}

  /** 注册 Debugger.resumed 监听器。Debugger.paused 由 facade 注册。 */
  attachListeners(session: CDPSession): void {
    this.resumedListener = () => this.handleResumed();
    session.on('Debugger.resumed', this.resumedListener);
  }

  /** 注销 Debugger.resumed 监听器。 */
  detachListeners(session: CDPSession): void {
    if (this.resumedListener) {
      session.off('Debugger.resumed', this.resumedListener);
      this.resumedListener = null;
    }
  }

  /** 内部状态清空（不调用 CDP，用于 facade disable 时的最终清理）。 */
  clearState(): void {
    this.pausedState = null;
    this.pausedResolvers = [];
  }

  async pause(): Promise<void> {
    await this.getCDPSession().send('Debugger.pause');
    logger.info('Execution paused');
  }

  async resume(): Promise<void> {
    await this.getCDPSession().send('Debugger.resume');
    // 乐观清空暂停状态：Debugger.resumed 事件在部分场景下可能延迟或丢失，
    // 导致 isPaused() / get_ai_debug_status 报告陈旧的 isPaused=true。
    // resume 指令成功下发后立即清空，保证状态与实际执行一致。
    this.pausedState = null;
    logger.info('Execution resumed');
  }

  async stepInto(): Promise<void> {
    await this.getCDPSession().send('Debugger.stepInto');
    logger.info('Step into');
  }

  async stepOver(): Promise<void> {
    await this.getCDPSession().send('Debugger.stepOver');
    logger.info('Step over');
  }

  async stepOut(): Promise<void> {
    await this.getCDPSession().send('Debugger.stepOut');
    logger.info('Step out');
  }

  async continueToLocation(
    location: Location,
    targetCallFrames?: 'any' | 'current',
  ): Promise<void> {
    const params: {location: Location; targetCallFrames?: 'any' | 'current'} = {
      location,
    };
    if (targetCallFrames !== undefined) {
      params.targetCallFrames = targetCallFrames;
    }
    await this.getCDPSession().send('Debugger.continueToLocation', params);
    logger.info('Continue to location', {location});
  }

  async setVariableValue(
    callFrameId: string,
    scopeNumber: number,
    variableName: string,
    newValue: CallArgument,
  ): Promise<void> {
    await this.getCDPSession().send('Debugger.setVariableValue', {
      callFrameId,
      scopeNumber,
      variableName,
      newValue,
    });
    logger.info(`Variable value set: ${variableName}`, {scopeNumber});
  }

  async restartFrame(callFrameId: string): Promise<void> {
    await this.getCDPSession().send('Debugger.restartFrame', {
      callFrameId,
      mode: 'StepInto',
    });
    logger.info(`Frame restarted: ${callFrameId}`);
  }

  async setReturnValue(newValue: CallArgument): Promise<void> {
    await this.getCDPSession().send('Debugger.setReturnValue', {newValue});
    logger.info('Return value overridden');
  }

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
      const resolver = (state: PausedState): void => {
        clearTimeout(timer);
        resolve(state);
      };
      const timer = setTimeout(() => {
        const index = this.pausedResolvers.indexOf(resolver);
        if (index > -1) {
          this.pausedResolvers.splice(index, 1);
        }
        reject(new Error('Timeout waiting for paused event'));
      }, timeout);

      this.pausedResolvers.push(resolver);
    });
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
    if (!this.pausedState) {
      throw new Error('Not in paused state');
    }

    const response = await this.getCDPSession().send(
      'Debugger.evaluateOnCallFrame',
      {
        callFrameId: params.callFrameId,
        expression: params.expression,
        returnByValue: params.returnByValue !== false,
        generatePreview: params.generatePreview ?? true,
      },
    );

    logger.info(`Evaluated on call frame: ${params.expression}`, {
      result: response.result.value,
    });

    const result = {
      type: response.result.type,
      ...(response.result.subtype !== undefined && {
        subtype: response.result.subtype,
      }),
      ...(response.result.className !== undefined && {
        className: response.result.className,
      }),
      ...(response.result.value !== undefined && {
        value: response.result.value,
      }),
      ...(response.result.description !== undefined && {
        description: response.result.description,
      }),
      ...(response.result.objectId !== undefined && {
        objectId: response.result.objectId,
      }),
    };

    const exceptionDetails = response.exceptionDetails
      ? {
          text: response.exceptionDetails.text,
          exception: response.exceptionDetails.exception
            ? {
                type: response.exceptionDetails.exception.type,
                value: response.exceptionDetails.exception.value,
                description: response.exceptionDetails.exception.description,
              }
            : undefined,
        }
      : undefined;

    return {result, exceptionDetails};
  }

  // ==================== 供 facade 协调的状态写入接口 ====================

  /**
   * 在 Debugger.paused 事件中写入 pausedState 并解析 waitForPaused 的等待者。
   * 由 facade 的 handlePaused 协调器调用。
   *
   * @returns 写入后的 PausedState
   */
  setPausedState(params: DebuggerPausedEvent): PausedState {
    this.pausedState = {
      callFrames: params.callFrames,
      reason: params.reason,
      data: params.data,
      hitBreakpoints: params.hitBreakpoints,
      timestamp: Date.now(),
    };

    logger.info('Execution paused', {
      reason: params.reason,
      location: params.callFrames[0]?.location,
      hitBreakpoints: params.hitBreakpoints,
    });

    for (const resolver of this.pausedResolvers) {
      resolver(this.pausedState);
    }
    this.pausedResolvers = [];

    return this.pausedState;
  }

  private handleResumed(): void {
    this.pausedState = null;
    logger.info('Execution resumed');
  }
}
