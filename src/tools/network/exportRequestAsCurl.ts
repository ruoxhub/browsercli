/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {ExportRequestAsCurlParams} from './types.js';

export const exportRequestAsCurl = defineTool({
  name: 'export_request_as_curl',
  description:
    '将捕获的网络请求（按 reqid）导出为 curl 命令。支持与 replay_network_request 相同的覆盖项。适用于在浏览器外复现请求，或验证导出的命令能否复现捕获的响应。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('要导出的已捕获网络请求的 reqid。'),
    method: zod.string().optional().describe('覆盖 HTTP 方法。'),
    url: zod.string().optional().describe('覆盖请求 URL。'),
    headers: zod
      .record(zod.string(), zod.string())
      .optional()
      .describe(
        '与原请求头合并的头部（键冲突时覆盖优先，大小写不敏感）。设置 replaceHeaders=true 可整体替换。',
      ),
    body: zod
      .string()
      .nullable()
      .optional()
      .describe('覆盖请求体。null 表示清空请求体。'),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        '若为 true，headers 参数将整体替换原始请求头。默认 false（合并）。',
      ),
    includeCookies: zod
      .boolean()
      .optional()
      .describe(
        '若为 true，将浏览器上下文中的 Cookie 作为 Cookie 请求头嵌入 curl 命令。默认 false（Cookie 与会话绑定，可能含敏感信息）。',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.exportCurl(
      getRuntime().contextProvider!,
      request.params as ExportRequestAsCurlParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'export_request_as_curl',
    });
  },
});
