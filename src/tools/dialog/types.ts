/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';

/**
 * Dialog 处理函数统一返回结构。
 *
 * 成功时 success=true，message 包含处理结果；
 * 失败时 success=false，message 包含错误描述。
 */
export interface DialogResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

/** Dialog 处理动作 */
export type DialogAction = 'accept' | 'dismiss';

/** Dialog 处理参数 */
export interface HandleDialogParams {
  /** 接受或关闭弹窗 */
  action: DialogAction;
  /** prompt 弹窗输入的文本（仅 action=accept 时有效） */
  promptText?: string;
}

/** 重新导出 Page 类型，方便调用方导入 */
export type {Page};