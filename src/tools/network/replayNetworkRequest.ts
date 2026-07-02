/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
} from './replayEngine.js';
import type {
  GetNetworkRequestData,
  ReplayNetworkRequestParams,
  ReplayOverride,
} from './types.js';

const DEFAULT_MAX_BODY_LENGTH = 2000;

function buildOriginalData(
  reqid: number,
  networkRequest: {
    url(): string;
    method(): string;
    postData(): string | null;
    resourceType(): string;
    headers(): Record<string, string>;
  },
  httpResponse: {
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  } | null,
): GetNetworkRequestData {
  return {
    reqid,
    url: networkRequest.url(),
    method: networkRequest.method(),
    resourceType: networkRequest.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    statusText: httpResponse?.statusText?.(),
    requestHeaders: networkRequest.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    postData: networkRequest.postData() ?? undefined,
  };
}

export const replayNetworkRequest = defineTool({
  name: 'replay_network_request',
  description:
    "Replay a captured network request (by reqid) using the browser context's cookies and storage. Supports overriding method, url, headers, and body. Useful for verifying signature field effects and parameter validity.",
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe(
        'The reqid of the captured network request to replay. Use list_network_requests to find it.',
      ),
    method: zod
      .string()
      .optional()
      .describe(
        'Override the HTTP method (e.g. POST, GET). Defaults to the original method.',
      ),
    url: zod
      .string()
      .optional()
      .describe('Override the request URL. Defaults to the original URL.'),
    headers: zod
      .record(zod.string(), zod.string())
      .optional()
      .describe(
        'Headers to merge with the original (override wins on key collision, case-insensitive). Set replaceHeaders=true to replace wholesale.',
      ),
    body: zod
      .string()
      .nullable()
      .optional()
      .describe(
        'Override the request body. null clears the body. Omit to keep the original. Only meaningful for POST/PUT/PATCH.',
      ),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        'If true, the headers param replaces the original headers entirely. Default false (merge).',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum length of the response body to return. Defaults to 2000 characters.',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params as ReplayNetworkRequestParams;
    const reqid = params.reqid;

    try {
      const page = context.getSelectedPage();
      const networkRequest = context.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(
        reqid,
        networkRequest,
        httpResponse,
      );

      const override: ReplayOverride | null =
        (params.method ??
        params.url ??
        params.headers ??
        params.body ??
        params.replaceHeaders !== undefined)
          ? {
              method: params.method,
              url: params.url,
              headers: params.headers,
              body: params.body,
              replaceHeaders: params.replaceHeaders,
            }
          : null;

      const built = buildReplayRequest(originalData, override ?? undefined);
      const maxBodyLength = params.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;

      try {
        const result = await executeReplay(
          page.context().request,
          built,
          maxBodyLength,
        );

        response.setStructuredContent({
          success: true,
          message: `请求重放成功：HTTP ${result.status}`,
          tooltype: 'replay_network_request',
          data: {
            ...result,
            originalReqid: reqid,
            override,
          },
        });
      } catch (execError) {
        response.setStructuredContent({
          success: false,
          message: `请求重放失败：${
            execError instanceof Error ? execError.message : String(execError)
          }`,
          tooltype: 'replay_network_request',
          data: {
            ...emptyReplayResponse(built.url),
            originalReqid: reqid,
            override,
          },
        });
      }
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `请求重放失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        tooltype: 'replay_network_request',
        data: {
          ...emptyReplayResponse(''),
          originalReqid: reqid,
          override: null,
        },
      });
    }
  },
});
