/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CapturedExchange} from '../../proxy/types.js';
import type {CapturedRequestInput} from '../types.js';

const toFlag = (value: boolean): number => (value ? 1 : 0);

// MITM 的 responseHeaders 类型上非空，但运行时可能为 undefined（历史数据 / 手工构造）。
const stringifyHeaders = (
  headers: Record<string, string> | undefined,
): string => JSON.stringify(headers ?? {});

/**
 * MITM 链路字段映射（spec §5）。纯函数、不抛错。
 *
 * 刻意丢弃的列：isOptions / isStatic（row 无对应列，噪声标记改由前端按
 * contentType 推导，见 §10）、requestId（跨源关联键，v2 的 source_ref 才恢复，
 * 见 §12）。durationMs 与 initiator 在 MITM 侧取不到，固定 0 / null。
 */
export function toCapturedRequestInput(
  exchange: CapturedExchange,
): CapturedRequestInput {
  return {
    timestamp: exchange.timestamp,
    method: exchange.method,
    url: exchange.url,
    source: 'proxy',
    requestHeaders: stringifyHeaders(exchange.requestHeaders),
    requestBody: exchange.requestBody,
    statusCode: exchange.statusCode,
    responseHeaders: stringifyHeaders(exchange.responseHeaders),
    responseBody: exchange.responseBody,
    contentType: exchange.contentType,
    initiator: exchange.clientProcess
      ? JSON.stringify({type: 'clientProcess', ...exchange.clientProcess})
      : null,
    durationMs: 0,
    isStreaming: toFlag(exchange.isStreaming),
    isWebSocket: toFlag(exchange.isWebSocket),
    truncated: toFlag(exchange.truncated),
  };
}
