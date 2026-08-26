/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {GetMitmRequestParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const getMitmRequest = defineTool({
  name: 'get_mitm_request',
  description:
    '获取单条 MITM 捕获请求的完整详情（请求头/请求体/响应头/响应体）。可选 saveTo 把响应体写入文件。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    id: zod
      .number()
      .int()
      .positive()
      .describe('捕获记录稳定 id，来自 list_mitm_requests。'),
    saveTo: zod
      .string()
      .optional()
      .describe('把响应体写入该文件路径，返回 savedPath，不写入响应内存。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.getRequest(
      request.params as GetMitmRequestParams,
    );
    response.setStructuredContent({...result, tooltype: 'get_mitm_request'});
  },
});
