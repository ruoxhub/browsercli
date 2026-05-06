/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {getRuntime} from '../../runtime.js';
import {resolveActivePageIndex} from '../shared/activePageResolver.js';
import type {HTTPRequest, ResourceType} from '../../third_party/index.js';
import type {
  ListNetworkRequestsData,
  ListNetworkRequestsParams,
  NetworkEvidenceCorrelation,
  NetworkRequestData,
} from './types.js';
import {FILTERABLE_RESOURCE_TYPES} from './types.js';

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

async function waitForMatchingRequest(options: {
  includePreservedRequests: boolean;
  targetPageIdx: number;
  waitForRequest: string;
  waitTimeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const requests = getRuntime().contextProvider!.getNetworkRequests(
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

function buildEvidenceCorrelations(
  requests: HTTPRequest[],
): NetworkEvidenceCorrelation[] {
  return requests
    .map((request): NetworkEvidenceCorrelation | null => {
      const reqid =
        getRuntime().contextProvider!.getNetworkRequestStableId(request);
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
        initiator: getRuntime().contextProvider!.getRequestInitiator(request),
        nextSteps: [
          '调用 get_request_initiator 查看完整调用栈',
          '调用 xhr_to_js_breakpoint 在请求发送前暂停',
          '暂停后调用 get_paused_info 和 evaluate_on_callframe 查看局部变量',
        ],
      };
    })
    .filter((item): item is NetworkEvidenceCorrelation => item !== null);
}

export const listNetworkRequests = defineTool({
  name: 'list_network_requests',
  description:
    'List all requests for the currently selected page since the last navigation. Supports filtering by resource type, header keyword, pagination, and waiting for matching requests.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum number of requests to return. When omitted, returns all requests.',
      ),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Page number to return (0-based). When omitted, returns the first page.',
      ),
    resourceTypes: zod
      .array(zod.enum(FILTERABLE_RESOURCE_TYPES))
      .optional()
      .describe(
        'Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.',
      ),
    includePreservedRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Set to true to return the preserved requests over the last 3 navigations.',
      ),
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Browser page index. When omitted, uses the currently active page.',
      ),
    waitForRequest: zod
      .string()
      .optional()
      .describe(
        'Wait for a request whose URL contains this fragment before returning.',
      ),
    waitTimeoutMs: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum time in milliseconds to wait for a matching request when waitForRequest is set.',
      ),
    headerFilter: zod
      .string()
      .optional()
      .describe(
        'Filter requests by a keyword present in their headers (case-insensitive).',
      ),
    includeSignatureEvidence: zod
      .boolean()
      .optional()
      .describe(
        'Include signature-related evidence correlations in the response.',
      ),
  },
  handler: async (request, response) => {
    try {
      const params = request.params as ListNetworkRequestsParams;
      const resultPageIdx = params.pageIdx ?? 0;
      const pageSize = params.pageSize;
      let targetPageIdx = params.targetPageIdx ?? 0;

      const includePreserved = params.includePreservedRequests ?? false;
      if (params.targetPageIdx === undefined) {
        const resolvedPage = resolveActivePageIndex(
          getRuntime().contextProvider!,
        );
        if ('message' in resolvedPage) {
          response.setStructuredContent({
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
          });
          return;
        }
        targetPageIdx = resolvedPage.pageIdx;
      }

      if (params.waitForRequest) {
        const matched = await waitForMatchingRequest({
          includePreservedRequests: includePreserved,
          targetPageIdx,
          waitForRequest: params.waitForRequest,
          waitTimeoutMs: params.waitTimeoutMs,
        });
        if (!matched) {
          const timeoutMs = params.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
          response.setStructuredContent({
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
          });
          return;
        }
      }

      let requests = getRuntime().contextProvider!.getNetworkRequests(
        includePreserved,
        targetPageIdx,
      );

      if (params.resourceTypes?.length) {
        const normalizedTypes = new Set(params.resourceTypes);
        requests = requests.filter(request => {
          return normalizedTypes.has(request.resourceType() as ResourceType);
        });
      }

      if (params.headerFilter) {
        const keyword = params.headerFilter.toLowerCase();
        requests = requests.filter(request => {
          const headers = getRequestHeaders(request);
          return Object.entries(headers).some(([key, value]) => {
            return `${key}: ${value}`.toLowerCase().includes(keyword);
          });
        });
      }

      const allData: NetworkRequestData[] = requests.map(request => {
        const reqid =
          getRuntime().contextProvider!.getNetworkRequestStableId(request);
        return serializeRequest(request, reqid);
      });

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
        ...(params.includeSignatureEvidence
          ? {
              evidenceCorrelations: buildEvidenceCorrelations(requests),
            }
          : {}),
      };

      response.setStructuredContent({
        success: true,
        message: `共 ${total} 个请求，返回 ${pagedData.length} 个`,
        tooltype: 'list_network_requests',
        logFormat: 'json',
        data,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `列出请求失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'list_network_requests',
        logFormat: 'json',
        data: {
          requests: [],
          total: 0,
          pageIdx: request.params.pageIdx ?? 0,
          pageSize: request.params.pageSize,
          targetPageIdx: 0,
          timedOut: false,
        },
      });
    }
  },
});
