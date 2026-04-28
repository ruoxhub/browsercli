/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HTTPRequest, ResourceType} from '../../third_party/index.js';
import type {
  ListNetworkRequestsData,
  ListNetworkRequestsParams,
  ListNetworkRequestsResult,
  NetworkRequestData,
  NetworkEvidenceCorrelation,
  NetworkRuntimeServices,
} from './types.js';
import {resolveActivePageIndex} from '../shared/activePageResolver.js';

const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const WAIT_POLL_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function getRequestHeaders(request: HTTPRequest): Record<string, string> {
  try {
    return request.headers();
  } catch {
    return {};
  }
}

const SIGNATURE_HEADER_PATTERN =
  /(^|[-_])(sign|signature|token|auth|nonce|timestamp)([-_]|$)|x-sign/i;

async function waitForMatchingRequest(
  runtime: NetworkRuntimeServices,
  options: {
    includePreservedRequests: boolean;
    targetPageIdx: number;
    waitForRequest: string;
    waitTimeoutMs?: number;
  },
): Promise<boolean> {
  const timeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const requests = runtime.getNetworkRequests(
      options.includePreservedRequests,
      options.targetPageIdx,
    );
    const hasMatch = requests.some(request =>
      request.url().includes(options.waitForRequest),
    );
    if (hasMatch) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }

    await sleep(Math.min(WAIT_POLL_INTERVAL_MS, remainingMs));
  }
}

/**
 * 将 HTTPRequest 序列化为精简结构化数据。
 *
 * 仅包含基本信息，详情使用 getNetworkRequest 获取。
 */
function serializeRequest(
  request: HTTPRequest,
  reqid: number,
): NetworkRequestData {
  return {
    reqid,
    url: request.url(),
    method: request.method(),
    postData: request.postData() ?? undefined,
    requestHeaders: getRequestHeaders(request),
  };
}

/**
 * 列出当前页面的所有网络请求（纯函数版本）。
 *
 * 从 NetworkRuntimeServices 获取请求数据，
 * 支持按资源类型过滤和分页。
 *
 * @param runtime - Network 运行时服务
 * @param params - 查询参数（分页、类型过滤等）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function listNetworkRequests(
  runtime: NetworkRuntimeServices,
  params?: ListNetworkRequestsParams,
): Promise<ListNetworkRequestsResult> {
  const resultPageIdx = params?.pageIdx ?? 0;
  const pageSize = params?.pageSize;
  let targetPageIdx = params?.targetPageIdx ?? 0;

  try {
    const includePreserved = params?.includePreservedRequests ?? false;
    if (params?.targetPageIdx === undefined) {
      const resolvedPage = resolveActivePageIndex(runtime);
      if ('message' in resolvedPage) {
        return {
          success: false,
          message: resolvedPage.message,
          tooltype: 'list_network_requests',
          logFormat: 'json',
          data: {
            requests: [],
            total: 0,
            pageIdx: resultPageIdx,
            pageSize,
            targetPageIdx: 0,
            timedOut: false,
          },
        };
      }
      targetPageIdx = resolvedPage.pageIdx;
    }

    if (params?.waitForRequest) {
      const matched = await waitForMatchingRequest(runtime, {
        includePreservedRequests: includePreserved,
        targetPageIdx,
        waitForRequest: params.waitForRequest,
        waitTimeoutMs: params.waitTimeoutMs,
      });
      if (!matched) {
        const timeoutMs = params.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
        return {
          success: false,
          message: `等待请求超时：${timeoutMs}ms 内未发现匹配 ${params.waitForRequest} 的请求`,
          tooltype: 'list_network_requests',
          logFormat: 'json',
          data: {
            requests: [],
            total: 0,
            pageIdx: resultPageIdx,
            pageSize,
            targetPageIdx,
            timedOut: true,
          },
        };
      }
    }

    let requests = runtime.getNetworkRequests(includePreserved, targetPageIdx);

    // 按资源类型过滤
    if (params?.resourceTypes?.length) {
      const normalizedTypes = new Set(params.resourceTypes);
      requests = requests.filter(request => {
        return normalizedTypes.has(request.resourceType() as ResourceType);
      });
    }

    if (params?.headerFilter) {
      const keyword = params.headerFilter.toLowerCase();
      requests = requests.filter(request => {
        const headers = getRequestHeaders(request);
        return Object.entries(headers).some(([key, value]) => {
          return `${key}: ${value}`.toLowerCase().includes(keyword);
        });
      });
    }

    // 序列化（精简版，仅包含基本信息）
    const allData: NetworkRequestData[] = requests.map(request => {
      const reqid = runtime.getNetworkRequestStableId(request);
      return serializeRequest(request, reqid);
    });

    // 分页
    const total = allData.length;

    let pagedData: NetworkRequestData[];
    if (pageSize) {
      const start = resultPageIdx * pageSize;
      pagedData = allData.slice(start, start + pageSize);
    } else {
      pagedData = allData;
    }

    const data: ListNetworkRequestsData = {
      requests: pagedData,
      total,
      pageIdx: resultPageIdx,
      targetPageIdx,
      pageSize,
      timedOut: false,
      ...(params?.includeSignatureEvidence
        ? {
            evidenceCorrelations: buildEvidenceCorrelations(runtime, requests),
          }
        : {}),
    };

    return {
      success: true,
      message: `共 ${total} 个请求，返回 ${pagedData.length} 个`,
      tooltype: 'list_network_requests',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `列出请求失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'list_network_requests',
      logFormat: 'json',
      data: {
        requests: [],
        total: 0,
        pageIdx: resultPageIdx,
        pageSize,
        targetPageIdx,
        timedOut: false,
      },
    };
  }
}

function buildEvidenceCorrelations(
  runtime: NetworkRuntimeServices,
  requests: HTTPRequest[],
): NetworkEvidenceCorrelation[] {
  return requests
    .map((request): NetworkEvidenceCorrelation | null => {
      const reqid = runtime.getNetworkRequestStableId(request);
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
        initiator: runtime.getRequestInitiator(request),
        nextSteps: [
          '调用 get_request_initiator 查看完整调用栈',
          '调用 xhr_to_js_breakpoint 在请求发送前暂停',
          '暂停后调用 get_paused_info 和 evaluate_on_callframe 查看局部变量',
        ],
      };
    })
    .filter((item): item is NetworkEvidenceCorrelation => item !== null);
}
