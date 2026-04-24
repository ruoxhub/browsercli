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
  NetworkRuntimeServices,
} from './types.js';

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
        return normalizedTypes.has(request.resourceType() as ResourceType);
      });
    }

    // 序列化（精简版，仅包含基本信息）
    const allData: NetworkRequestData[] = requests.map(request => {
      const reqid = runtime.getNetworkRequestStableId(request);
      return serializeRequest(request, reqid);
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
