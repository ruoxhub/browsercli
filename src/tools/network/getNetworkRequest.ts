/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const getNetworkRequest = defineTool({
  name: 'get_network_request',
  description:
    '按可选的 reqid 获取网络请求；若省略则返回 DevTools Network 面板中当前选中的请求。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .optional()
      .describe(
        '网络请求的 reqid。省略时返回 DevTools Network 面板中当前选中的请求。',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('返回的响应体最大长度。默认 300 字符。'),
    fullBody: zod
      .boolean()
      .optional()
      .describe('返回完整响应体，跳过默认截断。'),
    saveTo: zod
      .string()
      .optional()
      .describe('将响应体保存到指定文件路径，返回 savedPath，不占用响应内存。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.getRequest(
      getRuntime().contextProvider!,
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'get_network_request',
    });
  },
});
