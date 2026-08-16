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

export interface BreakpointLocation {
  scriptId?: string;
  url?: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface BreakpointInfo {
  breakpointId: string;
  location: BreakpointLocation;
  /** CDP 请求中的原始位置（URL/正则或 scriptId）。 */
  requestedLocation?: BreakpointLocation;
  /** CDP 实际解析出的可命中位置。 */
  resolvedLocations?: Location[];
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

/** 断点循环自动恢复事件 */
export interface AutoRecoveryEvent {
  breakpointId: string;
  signature: string;
  hitCount: number;
  timestamp: number;
  actions: string[];
  error?: string;
}

/** CDP Debugger.Location — scriptId + line/column position. */
export interface Location {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

/** CDP Debugger.BreakLocation — possible breakpoint position with type hint. */
export interface BreakLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
  type?: 'debuggerStatement' | 'call' | 'return';
}

/** CDP Runtime.CallArgument — value descriptor for variable/return value mutation. */
export interface CallArgument {
  value?: unknown;
  unserializableValue?: string;
  objectId?: string;
}

/** CDP Debugger.ScriptPosition — line/column within a script for blackbox ranges. */
export interface ScriptPosition {
  lineNumber: number;
  columnNumber: number;
}

/** Shared property filter for ScopeInspector. */
export function shouldFilterPropertyName(
  name: string,
  options?: {filterUnderscorePrefix?: boolean},
): boolean {
  if (name === '__proto__') return true;
  if (options?.filterUnderscorePrefix && name.startsWith('__')) return true;
  return false;
}
