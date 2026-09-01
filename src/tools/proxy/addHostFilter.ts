/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AddHostFilterParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const addHostFilter = defineTool({
  name: 'mitm_add_host_filter',
  description:
    '新增一条 MITM 域名过滤（allow 白名单 / block 黑名单），进程内生效直到 stop 或 clear。白名单非空时黑名单失效：不在白名单里的域名全部旁路（不解密不抓包）。host 为子串匹配，大小写不敏感。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    action: zod
      .enum(['allow', 'block'])
      .describe('allow=白名单（仅抓这些域名）；block=黑名单（跳过这些域名）。'),
    host: zod
      .string()
      .describe('hostname 子串，大小写不敏感（如 `ads.example.com`）。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.addHostFilter(
      request.params as AddHostFilterParams,
    );
    response.setStructuredContent({...result, tooltype: 'mitm_add_host_filter'});
  },
});
