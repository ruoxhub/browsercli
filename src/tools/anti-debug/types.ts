/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

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
