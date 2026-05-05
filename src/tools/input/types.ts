/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Input 工具已全部重构为 defineTool 格式，
// 原有的纯函数参数/返回类型不再需要。
// 保留本文件以防其他模块有类型引用，后续可移除。

import type {Frame} from '../../third_party/index.js';

/** 重新导出 Frame 类型 */
export type {Frame};
