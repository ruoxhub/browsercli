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

/**
 * 传输层抓取常量（spec §9）。会话侧配额见 src/modules/session/constants.ts。
 */

/** 单条响应体入库上限（1 MiB）。与 MITM 侧原 MAX_BODY_SIZE 同值同源。 */
export const MAX_CAPTURED_BODY_BYTES = 1024 * 1024;

/**
 * CDP 响应体读取超时。与 CdpNetworkMonitor.RESPONSE_BODY_TIMEOUT_MS
 * 同值同语义：text() 挂起时按无 body 摄入，不得拖垮采集链路。
 */
export const CDP_BODY_TIMEOUT_MS = 3000;

/**
 * CDP 响应体主动抓取开关（spec §13-D3）。切片 2 的 SessionCaptureBridge 读取。
 * 注意：截断发生在取体之后，白名单（contentType.ts）才是有效的成本控制。
 */
export const CDP_BODY_CAPTURE_ENABLED = true;
