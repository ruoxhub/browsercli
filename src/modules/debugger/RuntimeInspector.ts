/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RuntimeInspector - 运行时检查
 *
 * 功能:
 * 1. 获取调用堆栈(Call Stack)
 * 2. 获取作用域变量(Scope Variables)
 * 3. 获取对象属性(Object Properties)
 * 4. 表达式求值(Expression Evaluation)
 *
 * 设计原则:
 * - 薄封装 CDP Runtime 域,直接调用 CDP API
 * - 依赖 DebuggerManager 获取暂停状态
 * - 提供友好的数据格式化
 */

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';
import type {CodeCollector} from '../collector/CodeCollector.js';

import type {DebuggerManager, CallFrame, Scope} from './DebuggerManager.js';

export interface VariableInfo {
  name: string;
  value: unknown;
  type: string;
  objectId?: string;
  className?: string;
  description?: string;
}

export interface ScopeVariables {
  scopeType: string;
  scopeName?: string;
  variables: VariableInfo[];
}

export interface CallStackInfo {
  callFrames: Array<{
    callFrameId: string;
    functionName: string;
    location: {
      scriptId: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    scopeChain: Array<{
      type: string;
      name?: string;
    }>;
  }>;
  reason: string;
  timestamp: number;
}

interface RemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
  className?: string;
}

export class RuntimeInspector {
  private cdpSession: CDPSession | null = null;
  private enabled = false;

  constructor(
    private collector: CodeCollector,
    private debuggerManager: DebuggerManager,
  ) {}

  private requireSession(): CDPSession {
    if (!this.enabled || !this.cdpSession) {
      throw new Error(
        'Runtime inspector is not enabled. Call init() or enable() first.',
      );
    }
    return this.cdpSession;
  }

  async init(): Promise<void> {
    if (this.enabled) {
      logger.warn('Runtime inspector already enabled');
      return;
    }

    const page = await this.collector.getActivePage();
    this.cdpSession = await page.context().newCDPSession(page);
    await this.cdpSession.send('Runtime.enable');
    this.enabled = true;
    logger.info('Runtime inspector enabled');
  }

  /** enable 是 init 的别名,与其他模块保持一致 */
  async enable(): Promise<void> {
    return this.init();
  }

  isInitialized(): boolean {
    return this.enabled;
  }

  /** 启用异步堆栈追踪(委托给 DebuggerManager,因为需要 Debugger 域) */
  async enableAsyncStackTraces(maxDepth = 32): Promise<void> {
    if (!this.debuggerManager.isEnabled()) {
      throw new Error(
        'Debugger is not enabled. Call debuggerManager.enable() first.',
      );
    }

    await this.debuggerManager.setAsyncCallStackDepth(maxDepth);
    logger.info(`Async stack traces enabled with max depth: ${maxDepth}`);
  }

  async disableAsyncStackTraces(): Promise<void> {
    if (!this.debuggerManager.isEnabled()) {
      throw new Error('Debugger is not enabled');
    }

    await this.debuggerManager.setAsyncCallStackDepth(0);
    logger.info('Async stack traces disabled');
  }

  async disable(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      logger.warn('Runtime inspector not enabled');
      return;
    }

    try {
      await this.cdpSession.send('Runtime.disable');
    } catch (error) {
      logger.error('Failed to disable runtime inspector:', error);
      throw error;
    } finally {
      this.enabled = false;
      try {
        await this.cdpSession.detach();
      } catch (e) {
        logger.warn('Failed to detach CDP session:', e);
      }
      this.cdpSession = null;
      logger.info('Runtime inspector disabled and cleaned up');
    }
  }

  // ==================== 调用堆栈 ====================

  async getCallStack(): Promise<CallStackInfo | null> {
    const pausedState = this.debuggerManager.getPausedState();
    if (!pausedState) {
      logger.warn('Not in paused state, cannot get call stack');
      return null;
    }

    const callStackInfo: CallStackInfo = {
      callFrames: pausedState.callFrames.map((frame: CallFrame) => ({
        callFrameId: frame.callFrameId,
        functionName: frame.functionName || '(anonymous)',
        location: {
          scriptId: frame.location.scriptId,
          url: frame.url,
          lineNumber: frame.location.lineNumber,
          columnNumber: frame.location.columnNumber,
        },
        scopeChain: frame.scopeChain.map((scope: Scope) => ({
          type: scope.type,
          name: scope.name,
        })),
      })),
      reason: pausedState.reason,
      timestamp: pausedState.timestamp,
    };

    logger.info('Call stack retrieved', {
      frameCount: callStackInfo.callFrames.length,
      topFrame: callStackInfo.callFrames[0]?.functionName,
    });

    return callStackInfo;
  }

  // ==================== 作用域变量 ====================

  async getScopeVariables(callFrameId: string): Promise<ScopeVariables[]> {
    this.requireSession();

    if (!callFrameId) {
      throw new Error('callFrameId parameter is required');
    }

    const pausedState = this.debuggerManager.getPausedState();
    if (!pausedState) {
      throw new Error(
        'Not in paused state. Debugger must be paused to get scope variables.',
      );
    }

    const callFrame = pausedState.callFrames.find(
      frame => frame.callFrameId === callFrameId,
    );

    if (!callFrame) {
      throw new Error(
        `Call frame not found: ${callFrameId}. Use getCallStack() to see available frames.`,
      );
    }

    const scopeVariablesList: ScopeVariables[] = [];
    for (const scope of callFrame.scopeChain) {
      if (!scope.object.objectId) continue;

      const properties = await this.getObjectProperties(scope.object.objectId);
      scopeVariablesList.push({
        scopeType: scope.type,
        scopeName: scope.name,
        variables: properties,
      });
    }

    logger.info(`Scope variables retrieved for call frame ${callFrameId}`, {
      scopeCount: scopeVariablesList.length,
    });

    return scopeVariablesList;
  }

  async getCurrentScopeVariables(): Promise<ScopeVariables[]> {
    const pausedState = this.debuggerManager.getPausedState();

    if (!pausedState || pausedState.callFrames.length === 0) {
      throw new Error('Not in paused state or no call frames');
    }

    const topFrame = pausedState.callFrames[0];
    if (!topFrame) {
      throw new Error('No top frame available');
    }

    return this.getScopeVariables(topFrame.callFrameId);
  }

  // ==================== 对象属性 ====================

  async getObjectProperties(objectId: string): Promise<VariableInfo[]> {
    this.requireSession();

    if (!objectId) {
      throw new Error('objectId parameter is required');
    }

    const result = await this.cdpSession!.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      accessorPropertiesOnly: false,
      generatePreview: true,
    });

    const variables: VariableInfo[] = [];
    for (const prop of result.result) {
      if (!prop.value) continue;
      variables.push({
        name: prop.name,
        value: this.formatValue(prop.value),
        type: prop.value.type,
        objectId: prop.value.objectId,
        className: prop.value.className,
        description: prop.value.description,
      });
    }

    logger.info(`Object properties retrieved: ${objectId}`, {
      propertyCount: variables.length,
    });

    return variables;
  }

  // ==================== 表达式求值 ====================

  async evaluate(expression: string, callFrameId?: string): Promise<unknown> {
    if (!expression || expression.trim() === '') {
      throw new Error('expression parameter is required and cannot be empty');
    }

    const pausedState = this.debuggerManager.getPausedState();
    if (!pausedState) {
      throw new Error(
        'Not in paused state. Use evaluateGlobal() for global context evaluation.',
      );
    }

    const targetCallFrameId =
      callFrameId || pausedState.callFrames[0]?.callFrameId;
    if (!targetCallFrameId) {
      throw new Error('No call frame available for evaluation');
    }

    const result = await this.debuggerManager.evaluateOnCallFrame({
      callFrameId: targetCallFrameId,
      expression,
      returnByValue: true,
    });

    logger.info(`Expression evaluated: ${expression}`, {
      result: result.result.value,
    });

    return this.formatValue(result.result);
  }

  async evaluateGlobal(expression: string): Promise<unknown> {
    this.requireSession();

    if (!expression || expression.trim() === '') {
      throw new Error('expression parameter is required and cannot be empty');
    }

    const result = await this.cdpSession!.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    logger.info(`Global expression evaluated: ${expression}`, {
      result: (result.result as RemoteObject).value,
    });

    return this.formatValue(result.result);
  }

  // ==================== 辅助方法 ====================

  /** 将 CDP 的 RemoteObject 转换为友好格式 */
  private formatValue(remoteObject: RemoteObject): unknown {
    if (remoteObject.type === 'undefined') {
      return undefined;
    }
    if (remoteObject.type === 'object' && remoteObject.subtype === 'null') {
      return null;
    }
    if (remoteObject.value !== undefined) {
      return remoteObject.value;
    }
    if (remoteObject.description) {
      return remoteObject.description;
    }
    return `[${remoteObject.type}]`;
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

    logger.info('Runtime inspector closed');
  }
}
