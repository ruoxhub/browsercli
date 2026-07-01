/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Debugger 模块共享类型。
 *
 * 这些接口原本定义在 DebuggerManager.ts 中，god-class 拆分后移到此处，
 * 由 BreakpointManager / ExecutionController / ScopeInspector /
 * DebuggerSessionStore 共享。DebuggerManager.ts 重新导出以保持向后兼容。
 */

import type {ScopeVariable} from '../../types/index.js';

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

export interface DebuggerPausedEvent {
  callFrames: CallFrame[];
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
}

export interface DebuggerBreakpointResolvedEvent {
  breakpointId: string;
  location?: unknown;
}

/** ScopeInspector 接受的选项（与 ../../types 中的 GetScopeVariablesOptions 等价，但内联以解耦）。 */
export type ScopeVariableScope = ScopeVariable['scope'];
