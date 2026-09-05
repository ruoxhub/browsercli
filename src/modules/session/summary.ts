/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {CapturedRequestRow, CapturedRequestSummary} from './types.js';

/** 投影所需的最小列集：整行（引擎侧）和显式摘要行（Store 侧）都能直接传入。 */
export type SummarySource = Pick<
  CapturedRequestRow,
  | 'id'
  | 'sessionId'
  | 'sequence'
  | 'timestamp'
  | 'method'
  | 'url'
  | 'statusCode'
  | 'contentType'
  | 'source'
  | 'initiator'
  | 'truncated'
  | 'isStreaming'
>;

/**
 * → 摘要。字段顺序即 WS payload 与 REST 列表项的契约（spec §8）。
 * 刻意只吃 SummarySource：Store 侧不必为投影伪造 body/headers 字段。
 */
export function toSummary(row: SummarySource): CapturedRequestSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    sequence: row.sequence,
    timestamp: row.timestamp,
    method: row.method,
    url: row.url,
    statusCode: row.statusCode,
    contentType: row.contentType,
    source: row.source,
    initiator: row.initiator,
    truncated: row.truncated,
    isStreaming: row.isStreaming,
  };
}
