/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RegisterPersistentHookResult} from '../../modules/hook/index.js';
import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

// ─── Hook 安装函数返回类型 ─────────────────────────────

/**
 * Hook 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface HookResult<T = unknown> extends MessagesResult<T> {
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
 * Hook 管理操作统一返回结构（与 HookResult 相同）。
 */
export type HookManagementResult<T = unknown> = HookResult<T>;

/** 注入 Hook 返回数据 */
export interface InjectHookData {
  hookId: string;
  persisted: boolean;
  ranOnCurrentFrame: boolean;
  world: 'main' | 'isolated';
  requestedWorld: 'main' | 'isolated';
  effectiveWorld: 'main';
  persistentStrategy: 'addInitScript' | 'evaluate-once';
  applyMode?: 'existing-and-future';
  registered?: boolean;
  idempotent?: boolean;
  appliedFrames?: number;
  failedFrames?: RegisterPersistentHookResult['failedFrames'];
  partial?: boolean;
  warnings?: string[];
}

/** 注入 Hook 结果 */
export interface InjectHookResult extends HookManagementResult<InjectHookData> {
  tooltype: 'inject_hook';
}

/** 同步 Hook 数据返回数据 */
export interface SyncHookRecordsData {
  syncedHookIds: string[];
  totalRecords: number;
  hooks: unknown[];
}

/** 同步 Hook 数据结果 */
export interface SyncHookRecordsResult extends HookManagementResult<SyncHookRecordsData> {
  tooltype: 'list_created_hooks';
}

/** 获取 Hook 数据结果 */
export interface GetHookDataResult extends HookManagementResult<unknown> {
  tooltype: 'get_hook_data';
}

/** 移除 Hook 返回数据（浏览器端清理） */
export interface RemoveHookBrowserData {
  hookId: string;
}

/** 移除 Hook 结果（浏览器端清理） */
export interface RemoveHookBrowserResult extends HookManagementResult<RemoveHookBrowserData> {
  tooltype: 'remove_hook';
}

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
