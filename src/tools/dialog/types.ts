/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Page} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * Dialog 处理函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface DialogResult<T = unknown> extends MessagesResult<T> {
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
