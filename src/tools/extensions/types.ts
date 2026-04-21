/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

/**
 * Extensions 函数统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface ExtensionsResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
}

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};