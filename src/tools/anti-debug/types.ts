/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * Anti-Debug 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface HookResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** Bypass Debugger 目标 */
export type BypassTarget = 'eval' | 'Function' | 'constructor';

/** Anti-Anti-Debug 功能特性 */
export type AntiAntiDebugFeature =
  | 'fixedWindowSize'
  | 'fixedTime'
  | 'preventClose'
  | 'preventHistoryBack'
  | 'preventConsoleClear'
  | 'hideWebdriver';

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
