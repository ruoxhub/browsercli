/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {MessagesResult} from '../shared/types.js';

/**
 * Extensions 函数统一返回结构。
 */
export interface ExtensionsResult<T = unknown> extends MessagesResult<T> {}

/** 重新导出 Frame 类型，方便调用方导入 */
export type {Frame};
