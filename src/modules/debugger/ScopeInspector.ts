/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ScopeInspector - 作用域变量获取策略模块。
 *
 * 提取自 DebuggerManager.ts，负责：
 * 1. 从暂停状态的 scopeChain 提取变量（getScopeVariables）
 * 2. 递归展开对象属性（getObjectProperties）
 * 3. CDP Scope.type 到 ScopeVariable.scope 的规范化
 *
 * 通过 `getCDPSession` 访问 CDP，通过 `getPausedState` 读取当前暂停状态。
 */

import type {CDPSession} from '../../third_party/index.js';
import type {
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
  ScopeVariable,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import type {PausedState, Scope, ScopeVariableScope} from './types.js';

const KNOWN_SCOPE_TYPES: ReadonlyArray<ScopeVariableScope> = [
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

export class ScopeInspector {
  constructor(
    private getCDPSession: () => CDPSession,
    private getPausedState: () => PausedState | null,
  ) {}

  /**
   * 将 CDP Scope.type 转换为 ScopeVariable.scope 兼容的联合类型。
   * wasm-expression-stack 等扩展类型会被规范化为 'block'。
   */
  toScopeVariableScopeType(scopeType: Scope['type']): ScopeVariableScope {
    return (KNOWN_SCOPE_TYPES as readonly string[]).includes(scopeType)
      ? (scopeType as ScopeVariableScope)
      : 'block';
  }

  async getScopeVariables(
    options: GetScopeVariablesOptions = {},
  ): Promise<GetScopeVariablesResult> {
    this.getCDPSession(); // 触发 requireSession 校验

    const pausedState = this.getPausedState();
    if (!pausedState) {
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
      ? pausedState.callFrames.find(f => f.callFrameId === callFrameId)
      : pausedState.callFrames[0];

    if (!targetFrame) {
      throw new Error(`Call frame not found: ${callFrameId || 'top frame'}`);
    }

    const variables: ScopeVariable[] = [];
    const errors: Array<{scope: string; error: string}> = [];
    let successfulScopes = 0;

    for (const scope of targetFrame.scopeChain) {
      try {
        if (!scope.object.objectId) continue;

        const properties = await this.getCDPSession().send(
          'Runtime.getProperties',
          {objectId: scope.object.objectId, ownProperties: true},
        );

        const scopeType = this.toScopeVariableScopeType(scope.type);

        for (const prop of properties.result) {
          if (prop.name === '__proto__') continue;

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

          if (includeObjectProperties && prop.value?.objectId && maxDepth > 0) {
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
    if (maxDepth <= 0) {
      return [];
    }

    try {
      const properties = await this.getCDPSession().send(
        'Runtime.getProperties',
        {objectId, ownProperties: true},
      );

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
}
