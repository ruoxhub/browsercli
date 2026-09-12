/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ListMitmRequestsParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listMitmRequests = defineTool({
  name: 'list_mitm_requests',
  description:
    '列出 MITM 代理捕获到的请求（内存环形缓冲，最多保留最近 2000 条）。支持 URL 过滤与分页。',
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
      .describe('每页条数，省略返回全部。'),
    pageIdx: zod.number().int().min(0).optional().describe('页码，从 0 开始。'),
    filter: zod
      .string()
      .optional()
      .describe(
        'mitmproxy 风格流过滤表达式（如 "~m POST & ~c 200"、"!~a ~d example.com"、"~bq keyword"、"~p node"）。',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe('按 URL 包含片段过滤（大小写不敏感）。'),
    method: zod
      .string()
      .optional()
      .describe('HTTP 方法大写精确匹配（如 GET/POST）。'),
    statusCode: zod.number().int().optional().describe('响应状态码精确匹配。'),
    host: zod
      .string()
      .optional()
      .describe('URL hostname 包含片段（大小写不敏感）。'),
    headerContains: zod
      .object({name: zod.string(), value: zod.string()})
      .optional()
      .describe('命中「header 名相等（大小写不敏感）且值包含」的请求记录。'),
    bodyContains: zod
      .string()
      .optional()
      .describe('请求体或响应体包含片段（大小写不敏感）。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.listRequests(
      request.params as ListMitmRequestsParams,
    );
    response.setStructuredContent({...result, tooltype: 'list_mitm_requests'});
  },
});
