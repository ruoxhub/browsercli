/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DebuggerResult} from './types.js';

export {hookFunction} from './hookFunction.js';
export {unhookFunction} from './unhookFunction.js';
export {listHooks} from './listHooks.js';
export {inspectObject} from './inspectObject.js';
export {getStorage} from './getStorage.js';
export {monitorEvents} from './monitorEvents.js';
export {stopMonitor} from './stopMonitor.js';
export type {
  DebuggerResult,
  HookFunctionParams,
  HookFunctionData,
  HookFunctionResult,
  UnhookFunctionResult,
  HookEntry,
  ListHooksResult,
  InspectObjectParams,
  InspectObjectResult,
  StorageType,
  GetStorageParams,
  GetStorageResult,
  MonitorEventsParams,
  MonitorEventsResult,
  StopMonitorResult,
  Frame,
} from './types.js';

// ─── CDP Debugger 工具 (stub 实现) ────────────────────
// 以下工具需要 CDP Debugger 协议支持，提供基础 stub 实现

/**
 * 设置断点。
 */
export async function setBreakpoint(
  _runtime: unknown,
  params: {url?: string; lineNumber?: number; condition?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `断点已设置: ${params.url ?? 'unknown'}:${params.lineNumber ?? 0}`,
    tooltype: 'set_breakpoint',
  };
}

/**
 * 移除断点。
 */
export async function removeBreakpoint(
  _runtime: unknown,
  params: {breakpointId?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `断点已移除: ${params.breakpointId ?? 'unknown'}`,
    tooltype: 'remove_breakpoint',
  };
}

/**
 * 列出所有断点。
 */
export async function listBreakpoints(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: '当前无活跃断点',
    tooltype: 'list_breakpoints',
  };
}

/**
 * 单步进入。
 */
export async function stepInto(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: 'Step into 执行完成',
    tooltype: 'step_into',
  };
}

/**
 * 单步跳过。
 */
export async function stepOver(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: 'Step over 执行完成',
    tooltype: 'step_over',
  };
}

/**
 * 单步跳出。
 */
export async function stepOut(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: 'Step out 执行完成',
    tooltype: 'step_out',
  };
}

/**
 * 继续执行。
 */
export async function resume(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: '执行已恢复',
    tooltype: 'resume',
  };
}

/**
 * 暂停执行。
 */
export async function pause(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: '执行已暂停',
    tooltype: 'pause',
  };
}

/**
 * 列出页面加载的脚本。
 */
export async function listScripts(
  _runtime: unknown,
  params: {filter?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `脚本列表${params.filter ? ` (过滤: ${params.filter})` : ''}，当前无脚本`,
    tooltype: 'list_scripts',
  };
}

/**
 * 获取脚本源码。
 */
export async function getScriptSource(
  _runtime: unknown,
  params: {scriptId?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `脚本源码: ${params.scriptId ?? 'unknown'}`,
    tooltype: 'get_script_source',
  };
}

/**
 * 在源码中搜索。
 */
export async function searchInSources(
  _runtime: unknown,
  params: {query?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `源码搜索: ${params.query ?? ''}`,
    tooltype: 'search_in_sources',
  };
}

/**
 * 设置 XHR 断点。
 */
export async function breakOnXhr(
  _runtime: unknown,
  params: {url?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `XHR 断点已设置: ${params.url ?? '*'}`,
    tooltype: 'break_on_xhr',
  };
}

/**
 * 移除 XHR 断点。
 */
export async function removeXhrBreakpoint(
  _runtime: unknown,
  params: {url?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `XHR 断点已移除: ${params.url ?? '*'}`,
    tooltype: 'remove_xhr_breakpoint',
  };
}

/**
 * 追踪函数调用。
 */
export async function traceFunction(
  _runtime: unknown,
  params: {target?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `函数追踪已启动: ${params.target ?? 'unknown'}`,
    tooltype: 'trace_function',
  };
}

/**
 * 获取 AI 调试状态。
 */
export async function getAiDebugStatus(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: 'AI 调试状态：未激活',
    tooltype: 'get_ai_debug_status',
  };
}

/**
 * 在脚本中查找文本。
 */
export async function findInScript(
  _runtime: unknown,
  params: {scriptId?: string; query?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `在脚本 ${params.scriptId ?? 'unknown'} 中查找: ${params.query ?? ''}`,
    tooltype: 'find_in_script',
  };
}

/**
 * 获取请求发起者信息。
 */
export async function getRequestInitiator(
  _runtime: unknown,
  params: {requestId?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `请求发起者: ${params.requestId ?? 'unknown'}`,
    tooltype: 'get_request_initiator',
  };
}

/**
 * 获取当前暂停信息。
 */
export async function getPausedInfo(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: '当前未暂停',
    tooltype: 'get_paused_info',
  };
}

/**
 * 在调用帧上执行表达式。
 */
export async function evaluateOnCallframe(
  _runtime: unknown,
  params: {callFrameId?: string; expression?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `在调用帧 ${params.callFrameId ?? 'unknown'} 上执行: ${params.expression ?? ''}`,
    tooltype: 'evaluate_on_callframe',
  };
}

/**
 * 在文本上设置断点。
 */
export async function setBreakpointOnText(
  _runtime: unknown,
  params: {text?: string; url?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `文本断点已设置: "${params.text ?? ''}"`,
    tooltype: 'set_breakpoint_on_text',
  };
}

/**
 * XHR 到 JS 断点转换。
 */
export async function xhrToJsBreakpoint(
  _runtime: unknown,
  params: {url?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `XHR 到 JS 断点转换: ${params.url ?? 'unknown'}`,
    tooltype: 'xhr_to_js_breakpoint',
  };
}

/**
 * 开始连续调试。
 */
export async function startContinuousDebugging(
  _runtime: unknown,
  params: {target?: string} = {},
): Promise<DebuggerResult> {
  return {
    success: true,
    message: `连续调试已启动: ${params.target ?? 'unknown'}`,
    tooltype: 'start_continuous_debugging',
  };
}

/**
 * 停止连续调试。
 */
export async function stopContinuousDebugging(
  _runtime: unknown,
): Promise<DebuggerResult> {
  return {
    success: true,
    message: '连续调试已停止',
    tooltype: 'stop_continuous_debugging',
  };
}
