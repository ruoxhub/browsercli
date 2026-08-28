/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 文本 MIME 片段白名单。原样来自 src/modules/network/NetworkModule.ts，
 * 提取为单一来源供 NetworkModule 与 CDP 抓包 adapter 共用（spec §5.1 / R9）。
 *
 * 刻意用白名单而非二进制黑名单：黑名单会漏 application/wasm、
 * application/x-font-woff、application/x-protobuf 等。
 */
export const TEXTUAL_CONTENT_TYPES = ['json', 'text', 'javascript'];

export function isTextualContentType(contentType: string): boolean {
  return TEXTUAL_CONTENT_TYPES.some(token => contentType.includes(token));
}
