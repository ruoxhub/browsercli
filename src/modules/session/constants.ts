/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 会话侧配额常量（spec §6 / §9）。传输层常量见 src/modules/network/constants.ts。
 */

/** 无活动会话时自动创建的默认会话名（spec §6）。 */
export const DEFAULT_SESSION_NAME = 'default';

/** 单会话保留请求行数上限，超出按 sequence 淘汰最旧（spec §9 / D4）。 */
export const DEFAULT_SESSION_KEEP = 5000;

/** 每成功落库多少次触发一次 trim，摊销删除成本（spec §9 / D4）。 */
export const TRIM_EVERY_INGESTS = 200;

/** 列表接口默认返回条数（spec §9）。 */
export const LIST_DEFAULT_LIMIT = 500;

/** 列表接口硬上限（spec §9）。 */
export const LIST_MAX_LIMIT = 2000;
