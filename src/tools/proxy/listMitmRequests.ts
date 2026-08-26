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
    urlFilter: zod
      .string()
      .optional()
      .describe('按 URL 包含片段过滤（大小写不敏感）。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.listRequests(
      request.params as ListMitmRequestsParams,
    );
    response.setStructuredContent({...result, tooltype: 'list_mitm_requests'});
  },
});
