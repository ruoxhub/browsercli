/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 所有工具的统一响应结果类型。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 *
 * 各工具通过 extends MessagesResult<T> 并指定 tooltype 字面量来定义具体结果类型。
 * 所有工具的业务数据统一放在 data 字段中。
 */
export interface MessagesResult<T = unknown> {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 结果数据 — 所有工具的业务数据统一放在此字段 */
  data: T;
}
