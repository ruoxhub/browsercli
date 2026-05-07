/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * Vue Hook 函数统一返回结构（兼容旧字段 logFormat）。
 */
export interface HookResult<T = unknown> extends MessagesResult<T> {
  /** 使用的日志格式 */
  logFormat?: string;
}

/** Vue Router 守卫类型 */
export type VueGuard = 'beforeEach' | 'beforeResolve' | 'afterEach' | 'all';

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
