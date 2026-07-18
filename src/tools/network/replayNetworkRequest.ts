/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {ReplayNetworkRequestParams} from './types.js';

export const replayNetworkRequest = defineTool({
  name: 'replay_network_request',
  description:
    '重放一个捕获的网络请求（按 reqid），使用浏览器上下文的 Cookie 和存储。支持覆盖 method、url、headers 和 body。适用于验证签名字段效果与参数有效性。',
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
        '要重放的已捕获网络请求的 reqid。可用 list_network_requests 查找。',
      ),
    method: zod
      .string()
      .optional()
      .describe(
        '覆盖 HTTP 方法（如 POST、GET）。默认使用原方法。',
      ),
    url: zod
      .string()
      .optional()
      .describe('覆盖请求 URL。默认使用原 URL。'),
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
      .describe(
        '覆盖请求体。null 表示清空请求体。省略则保留原请求体。仅对 POST/PUT/PATCH 有意义。',
      ),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        '若为 true，headers 参数将整体替换原始请求头。默认 false（合并）。',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '返回的响应体最大长度。默认 2000 字符。',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.replayRequest(
      getRuntime().contextProvider!,
      request.params as ReplayNetworkRequestParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'replay_network_request',
    });
  },
});
