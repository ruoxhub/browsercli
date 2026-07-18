/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import {FILTERABLE_RESOURCE_TYPES} from './types.js';

export const listNetworkRequests = defineTool({
  name: 'list_network_requests',
  description:
    '列出当前选中页面自上次导航以来的所有请求。支持按资源类型、请求头关键字、分页过滤，以及等待匹配的请求。',
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
        '返回的最大请求数。省略时返回全部请求。',
      ),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '返回的页码（从 0 开始）。省略时返回第一页。',
      ),
    resourceTypes: zod
      .array(zod.enum(FILTERABLE_RESOURCE_TYPES))
      .optional()
      .describe(
        '仅返回指定资源类型的请求。省略或为空时返回全部请求。',
      ),
    includePreservedRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        '设为 true 可返回最近 3 次导航期间保留的请求。',
      ),
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '浏览器页面索引。省略时使用当前活动页面。',
      ),
    waitForRequest: zod
      .string()
      .optional()
      .describe(
        '返回前等待 URL 包含该片段的请求出现。',
      ),
    waitTimeoutMs: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '设置 waitForRequest 时，等待匹配请求的最长时间（毫秒）。',
      ),
    headerFilter: zod
      .string()
      .optional()
      .describe(
        '按请求头中包含的关键字过滤请求（大小写不敏感）。',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        '按 URL 中包含的关键字过滤请求（大小写不敏感）。',
      ),
    includeSignatureEvidence: zod
      .boolean()
      .optional()
      .describe(
        '在响应中包含与签名相关的证据关联。',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.listRequests(
      getRuntime().contextProvider!,
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'list_network_requests',
    });
  },
});
