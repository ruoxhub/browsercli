/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

const EMPTY_REQUEST_DATA = {
  reqid: 0,
  url: '',
  method: '',
  resourceType: '',
  statusCode: 0,
  requestHeaders: {},
  responseHeaders: {},
} as const;

const TEXTUAL_CONTENT_TYPES = ['json', 'text', 'javascript'];

function isTextualContentType(contentType: string): boolean {
  return TEXTUAL_CONTENT_TYPES.some(token => contentType.includes(token));
}

export const getNetworkRequest = defineTool({
  name: 'get_network_request',
  description:
    'Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .optional()
      .describe(
        'The reqid of the network request. If omitted returns the currently selected request in the DevTools Network panel.',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum length of the response body to return. Defaults to 300 characters.',
      ),
  },
  handler: async (request, response) => {
    try {
      let reqid = request.params.reqid;
      if (!reqid) {
        const devToolsData =
          (await getRuntime().contextProvider!.getDevToolsData()) as any;
        if (devToolsData?.cdpRequestId) {
          reqid = getRuntime().contextProvider!.resolveCdpRequestId(
            devToolsData.cdpRequestId,
          );
        }
      }

      if (!reqid) {
        response.setStructuredContent({
          success: false,
          message: '未指定 reqid，且 DevTools Network 面板未选中任何请求',
          tooltype: 'get_network_request',
          data: {...EMPTY_REQUEST_DATA},
        });
        return;
      }

      const networkRequest =
        getRuntime().contextProvider!.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response();

      const maxBodyLength = request.params.maxBodyLength ?? 300;
      let responseBody: string | undefined;
      if (httpResponse) {
        try {
          const contentType = httpResponse.headers()['content-type'] ?? '';
          if (isTextualContentType(contentType)) {
            const fullBody = await httpResponse.text();
            responseBody =
              fullBody.length > maxBodyLength
                ? fullBody.slice(0, maxBodyLength) + '\n... [truncated]'
                : fullBody;
          }
        } catch {
          // 忽略读取失败
        }
      }

      const data = {
        reqid,
        url: networkRequest.url(),
        method: networkRequest.method(),
        resourceType: networkRequest.resourceType(),
        postData: networkRequest.postData() ?? undefined,
        statusCode: httpResponse?.status() ?? 0,
        statusText: httpResponse?.statusText?.(),
        requestHeaders: networkRequest.headers(),
        responseHeaders: httpResponse?.headers() ?? {},
        initiator:
          getRuntime().contextProvider!.getRequestInitiator(networkRequest),
        responseBody,
      };

      response.setStructuredContent({
        success: true,
        message: `请求 ID=${reqid} 获取成功`,
        tooltype: 'get_network_request',
        data,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `获取请求失败：${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_network_request',
        logFormat: 'json',
        data: {
          ...EMPTY_REQUEST_DATA,
          reqid: request.params.reqid ?? 0,
        },
      });
    }
  },
});
