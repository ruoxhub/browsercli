/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RemoveHostFilterParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const removeHostFilter = defineTool({
  name: 'mitm_remove_host_filter',
  description: '移除一条 MITM 域名过滤（需与添加时相同的 action 与 host）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    action: zod.enum(['allow', 'block']).describe('要移除哪张表里的条目。'),
    host: zod.string().describe('添加时用的 hostname 子串。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.removeHostFilter(
      request.params as RemoveHostFilterParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_remove_host_filter',
    });
  },
});
