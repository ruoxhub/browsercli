/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {buildReplayRequest, formatCurl} from './replayEngine.js';
import type {
  ExportRequestAsCurlParams,
  GetNetworkRequestData,
  ReplayOverride,
} from './types.js';

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

/** Cookie 域匹配：host 等于 domain，或 host 以 "." + domain 结尾。 */
function cookieMatchesHost(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase();
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

export const exportRequestAsCurl = defineTool({
  name: 'export_request_as_curl',
  description:
    'Export a captured network request (by reqid) as a curl command. Supports the same overrides as replay_network_request. Useful for reproducing a request outside the browser or verifying that an exported command reproduces the captured response.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('The reqid of the captured network request to export.'),
    method: zod.string().optional().describe('Override the HTTP method.'),
    url: zod.string().optional().describe('Override the request URL.'),
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
      .describe('Override the request body. null clears the body.'),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        'If true, the headers param replaces the original headers entirely. Default false (merge).',
      ),
    includeCookies: zod
      .boolean()
      .optional()
      .describe(
        'If true, embed cookies from the browser context as a Cookie header in the curl command. Default false (cookies are session-bound and may be sensitive).',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params as ExportRequestAsCurlParams;
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

      let cookies: Array<{name: string; value: string}> | undefined;
      let cookieNote = '';
      if (params.includeCookies === true) {
        try {
          const allCookies = await page.context().cookies();
          let host: string;
          try {
            host = new URL(built.url).hostname;
          } catch {
            host = '';
          }
          cookies = allCookies
            .filter(c => cookieMatchesHost(c.domain, host))
            .map(c => ({name: c.name, value: c.value}));
        } catch {
          cookieNote = '（Cookie 读取失败，已省略）';
        }
      }

      const curl = formatCurl(built, {
        includeCookies: params.includeCookies === true,
        cookies,
      });

      response.setStructuredContent({
        success: true,
        message: `已导出 curl 命令${cookieNote}`,
        tooltype: 'export_request_as_curl',
        data: {
          curl,
          originalReqid: reqid,
          override,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `导出 curl 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        tooltype: 'export_request_as_curl',
        data: {
          curl: '',
          originalReqid: reqid,
          override: null,
        },
      });
    }
  },
});
