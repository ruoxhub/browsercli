/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HTTPRequest} from '../../third_party/index.js';

import {SIGNATURE_HEADER_PATTERN} from './constants.js';
import type {
  NetworkEvidenceCorrelation,
  NetworkServices,
} from './NetworkTypes.js';

function getRequestHeaders(request: HTTPRequest): Record<string, string> {
  try {
    return request.headers();
  } catch {
    return {};
  }
}

/**
 * 构建签名相关证据关联：扫描请求头中匹配 `SIGNATURE_HEADER_PATTERN` 的字段，
 * 返回每个匹配请求的 reqid、签名指示符、发起者信息与下一步建议。
 *
 * 抽取自原 `listNetworkRequests` tool handler。
 */
export function buildEvidenceCorrelations(
  requests: HTTPRequest[],
  services: NetworkServices,
): NetworkEvidenceCorrelation[] {
  return requests
    .map((request): NetworkEvidenceCorrelation | null => {
      const reqid = services.getNetworkRequestStableId(request);
      const headers = getRequestHeaders(request);
      const signatureIndicators = Object.keys(headers).filter(key =>
        SIGNATURE_HEADER_PATTERN.test(key),
      );
      if (signatureIndicators.length === 0) {
        return null;
      }

      return {
        reqid,
        signatureIndicators,
        initiator: services.getRequestInitiator(request),
        nextSteps: [
          '调用 get_request_initiator 查看完整调用栈',
          '调用 xhr_to_js_breakpoint 在请求发送前暂停',
          '暂停后调用 get_paused_info 和 evaluate_on_callframe 查看局部变量',
        ],
      };
    })
    .filter((item): item is NetworkEvidenceCorrelation => item !== null);
}
