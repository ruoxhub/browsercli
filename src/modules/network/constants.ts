/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 签名相关请求头匹配模式。
 *
 * 匹配 sign / signature / token / auth / nonce / timestamp 关键字（含连字符/下划线分隔），
 * 以及 x-sign 前缀头。用于在网络请求中识别签名相关证据。
 */
export const SIGNATURE_HEADER_PATTERN =
  /(^|[-_])(sign|signature|token|auth|nonce|timestamp)([-_]|$)|x-sign/i;
