/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * Debugger 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface DebuggerResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
  /** 可选的结构化结果 */
  data?: unknown;
}

/** Hook 函数参数 */
export interface HookFunctionParams {
  /** 函数目标路径 (如 "XMLHttpRequest.prototype.open", "window.fetch") */
  target: string;
  /** 是否记录函数参数 (默认 true) */
  logArgs?: boolean;
  /** 是否记录返回值 (默认 true) */
  logResult?: boolean;
  /** 是否记录调用栈 (默认 false) */
  logStack?: boolean;
  /** 自定义 Hook ID，默认用 target 名 */
  hookId?: string;
}

/** Hook 函数返回数据 */
export interface HookFunctionData {
  hookId: string;
  target: string;
}

/** Hook 函数结果 */
export interface HookFunctionResult extends DebuggerResult {
  tooltype: 'hook_function';
  data?: HookFunctionData;
}

/** Unhook 函数结果 */
export interface UnhookFunctionResult extends DebuggerResult {
  tooltype: 'unhook_function';
}

/** Hook 条目 */
export interface HookEntry {
  id: string;
  target: string;
}

/** List Hooks 结果 */
export interface ListHooksResult extends DebuggerResult {
  tooltype: 'list_hooks';
  data?: HookEntry[];
}

/** Inspect Object 参数 */
export interface InspectObjectParams {
  /** JavaScript 表达式 (如 "window.app") */
  expression: string;
  /** 嵌套深度 (默认 2) */
  depth?: number;
  /** 是否展示方法 (默认 true) */
  showMethods?: boolean;
  /** 是否展示原型链 (默认 true) */
  showPrototype?: boolean;
}

/** Inspect Object 结果 */
export interface InspectObjectResult extends DebuggerResult {
  tooltype: 'inspect_object';
  data?: Record<string, unknown>;
}

/** Storage 类型 */
export type StorageType = 'all' | 'cookies' | 'localStorage' | 'sessionStorage';

/** Get Storage 参数 */
export interface GetStorageParams {
  /** 要获取的存储类型 (默认 all) */
  type?: StorageType;
  /** 按键名过滤 */
  filter?: string;
}

/** Get Storage 结果 */
export interface GetStorageResult extends DebuggerResult {
  tooltype: 'get_storage';
  data?: Record<string, unknown>;
}

/** Monitor Events 参数 */
export interface MonitorEventsParams {
  /** CSS 选择器或 "window"/"document" (默认 window) */
  selector?: string;
  /** 要监控的事件列表 */
  events?: string[];
  /** 自定义监控 ID */
  monitorId?: string;
}

/** Monitor Events 结果 */
export interface MonitorEventsResult extends DebuggerResult {
  tooltype: 'monitor_events';
  data?: {monitorId: string; eventCount: number};
}

/** Stop Monitor 结果 */
export interface StopMonitorResult extends DebuggerResult {
  tooltype: 'stop_monitor';
}

/** 重新导出 Frame 类型 */
export type {Frame};
