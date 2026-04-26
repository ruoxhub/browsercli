/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

// ─── Hook 安装函数返回类型 ─────────────────────────────

/**
 * Hook 函数统一返回结构。
 *
 * 成功时 success=true，message 包含安装确认；
 * 失败时 success=false，message 包含错误描述。
 */
export interface HookResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 日志输出格式 */
export type LogFormat = 'full' | 'compact' | 'json';

/** Storage 操作类型 */
export type StorageAction = 'setItem' | 'getItem' | 'removeItem' | 'clear';

/** Console 保护模式 */
export type ConsoleProtectMode = 'proxy' | 'toString' | 'freeze';

/** Bypass Debugger 目标 */
export type BypassTarget = 'eval' | 'Function' | 'constructor';

// ─── Hook 管理函数返回类型 ─────────────────────────────

/**
 * Hook 管理操作统一返回结构。
 *
 * 成功时 success=true，message 包含操作确认；
 * 失败时 success=false，message 包含错误描述。
 */
export interface HookManagementResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/** 注入 Hook 结果 */
export interface InjectHookResult extends HookManagementResult {
  tooltype: 'inject_hook';
  hookId: string;
}

/** 同步 Hook 数据结果 */
export interface SyncHookRecordsResult extends HookManagementResult {
  tooltype: 'list_created_hooks';
  syncedHookIds: string[];
  totalRecords: number;
  hooks: unknown[];
}

/** 获取 Hook 数据结果 */
export interface GetHookDataResult extends HookManagementResult {
  tooltype: 'get_hook_data';
  data: unknown;
}

/** 移除 Hook 结果（浏览器端清理） */
export interface RemoveHookBrowserResult extends HookManagementResult {
  tooltype: 'remove_hook';
  hookId: string;
}

// ─── 重新导出 ──────────────────────────────────────────

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
