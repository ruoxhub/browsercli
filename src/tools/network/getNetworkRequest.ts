/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GetNetworkRequestData,
  GetNetworkRequestParams,
  GetNetworkRequestResult,
  NetworkRuntimeServices,
} from './types.js';

/**
 * 通过 ID 获取单条网络请求详情（纯函数版本）。
 *
 * 如果省略 reqid，则尝试从 DevTools UI 当前选中请求获取。
 *
 * @param runtime - Network 运行时服务
 * @param params - 查询参数（可选 reqid）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function getNetworkRequest(
  runtime: NetworkRuntimeServices,
  params?: GetNetworkRequestParams,
): Promise<GetNetworkRequestResult> {
  try {
    // 解析 reqid：显式传入 > DevTools UI 选中
    let reqid = params?.reqid;
    if (!reqid) {
      const devToolsData = await runtime.getDevToolsData();
      if (devToolsData?.cdpRequestId) {
        reqid = runtime.resolveCdpRequestId(devToolsData.cdpRequestId);
      }
    }

    if (!reqid) {
      return {
        success: false,
        message: '未指定 reqid，且 DevTools Network 面板未选中任何请求',
        tooltype: 'get_network_request',
        logFormat: 'json',
        data: {
          reqid: 0,
          url: '',
          method: '',
          resourceType: '',
          statusCode: 0,
          requestHeaders: {},
          responseHeaders: {},
        },
      };
    }

    const request = runtime.getNetworkRequestById(reqid);
    const httpResponse = request.response();
    const data: GetNetworkRequestData = {
      reqid,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      statusCode: httpResponse?.status() ?? 0,
      requestHeaders: request.headers(),
      responseHeaders: httpResponse?.headers() ?? {},
      initiator: runtime.getRequestInitiator(request),
    };

    return {
      success: true,
      message: `请求 ID=${reqid} 获取成功`,
      tooltype: 'get_network_request',
      logFormat: 'json',
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: `获取请求失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'get_network_request',
      logFormat: 'json',
      data: {
        reqid: params?.reqid ?? 0,
        url: '',
        method: '',
        resourceType: '',
        statusCode: 0,
        requestHeaders: {},
        responseHeaders: {},
      },
    };
  }
}
