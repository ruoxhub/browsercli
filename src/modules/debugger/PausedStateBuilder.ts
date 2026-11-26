/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PausedStateBuilder — 从 DebuggerManager 暂停态构建结构化暂停信息
 * （从 tools/debugger.ts 下沉至 L1 modules/debugger，供 get_paused_info 与 step_* 共用）。
 */

import type {DebuggerManager} from './DebuggerManager.js';

export const SCOPE_VAR_LIMIT = 20;
export const FRAME_LOCAL_LIMIT = 10;

export interface FrameLocalVar {
  name: string;
  type: string;
  value: unknown;
}

export interface PausedInfoData {
  isPaused: true;
  reason?: string;
  hitBreakpoints?: string[];
  callFrames: Array<{
    index: number;
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    callFrameId: string;
    locals?: FrameLocalVar[];
    localCount?: number;
  }>;
  scopes?: Array<{
    scopeName: string;
    scopeType: string;
    variables?: Array<{name: string; value: unknown}>;
  }>;
}

export async function buildPausedInfoData(
  debuggerContext: DebuggerManager,
  options: {includeScopes?: boolean; scopeFrames?: 'top' | 'all'} = {},
): Promise<PausedInfoData | null> {
  const pausedState = debuggerContext.getPausedState();
  if (!pausedState) {
    return null;
  }

  const callFrames: PausedInfoData['callFrames'] = pausedState.callFrames.map(
    (frame, i) => {
      const script = debuggerContext.getScriptById(frame.location.scriptId);
      const url =
        script?.url || frame.url || `script:${frame.location.scriptId}`;
      return {
        index: i + 1,
        functionName: frame.functionName,
        url,
        lineNumber: frame.location.lineNumber + 1,
        columnNumber: frame.location.columnNumber ?? 0,
        callFrameId: frame.callFrameId,
      };
    },
  );

  const result: PausedInfoData = {
    isPaused: true,
    reason: pausedState.reason || undefined,
    hitBreakpoints:
      pausedState.hitBreakpoints?.length > 0
        ? pausedState.hitBreakpoints
        : undefined,
    callFrames,
  };

  if (options.includeScopes !== false && pausedState.callFrames.length > 0) {
    const topFrame = pausedState.callFrames[0];
    const scopes: NonNullable<PausedInfoData['scopes']> = [];

    for (const scope of topFrame.scopeChain) {
      if (scope.type === 'global') {
        continue;
      }

      const scopeData: NonNullable<PausedInfoData['scopes']>[number] = {
        scopeName: scope.name || scope.type,
        scopeType: scope.type,
      };

      if (scope.object.objectId) {
        try {
          const variables = await debuggerContext.getScopeVariablesForObjectId(
            scope.object.objectId,
          );

          if (variables.length > 0) {
            scopeData.variables = variables.slice(0, 20).map(v => ({
              name: v.name,
              value: v.value,
            }));
            if (variables.length > SCOPE_VAR_LIMIT) {
              scopeData.variables.push({
                name: `... 还有 ${variables.length - 20} 个`,
                value: null,
              });
            }
          }
        } catch {
          // ignore individual scope read failures
        }
      }

      scopes.push(scopeData);
    }

    result.scopes = scopes;

    if (options.scopeFrames === 'all') {
      await Promise.all(
        pausedState.callFrames.map(async (frame, idx) => {
          const locals: FrameLocalVar[] = [];
          const localScope = frame.scopeChain.find(s => s.type === 'local');
          if (localScope?.object?.objectId) {
            try {
              const vars = await debuggerContext.getScopeVariablesForObjectId(
                localScope.object.objectId,
              );
              locals.push(
                ...vars.map(v => ({
                  name: v.name,
                  type: v.type,
                  value: v.value,
                })),
              );
            } catch {
              // ignore individual scope read failures
            }
          }
          callFrames[idx].locals = locals.slice(0, FRAME_LOCAL_LIMIT);
          callFrames[idx].localCount = locals.length;
        }),
      );
    }
  }

  return result;
}
