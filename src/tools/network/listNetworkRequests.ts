/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {HTTPRequest} from '../../third_party/index.js';
import type {
  ListNetworkRequestsData,
  ListNetworkRequestsParams,
  ListNetworkRequestsResult,
  NetworkRequestData,
  NetworkRuntimeServices,
} from './types.js';

/**
 * 将 HTTPRequest 序列化为结构化数据。
 */
function serializeRequest(
  request: HTTPRequest,
  reqid: number,
  runtime: NetworkRuntimeServices,
): NetworkRequestData {
  const httpResponse = request.response();
  return {
    reqid,
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    requestHeaders: request.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    initiator: runtime.getRequestInitiator(request),
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
  try {
    const includePreserved = params?.includePreservedRequests ?? false;
    let requests = runtime.getNetworkRequests(includePreserved);

    // 按资源类型过滤
    if (params?.resourceTypes?.length) {
      const normalizedTypes = new Set(params.resourceTypes);
      requests = requests.filter(request => {
        return normalizedTypes.has(request.resourceType());
      });
    }

    // 序列化
    const allData: NetworkRequestData[] = requests.map(request => {
      const reqid = runtime.getNetworkRequestStableId(request);
      return serializeRequest(request, reqid, runtime);
    });

    // 分页
    const total = allData.length;
    const pageSize = params?.pageSize;
    const pageIdx = params?.pageIdx ?? 0;

    let pagedData: NetworkRequestData[];
    if (pageSize) {
      const start = pageIdx * pageSize;
      pagedData = allData.slice(start, start + pageSize);
    } else {
      pagedData = allData;
    }

    const data: ListNetworkRequestsData = {
      requests: pagedData,
      total,
      pageIdx,
      pageSize,
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
        pageIdx: 0,
        pageSize: undefined,
      },
    };
  }
}
