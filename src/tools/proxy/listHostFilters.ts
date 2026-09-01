/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listHostFilters = defineTool({
  name: 'mitm_list_host_filters',
  description: '列出当前生效的 MITM 域名过滤（白名单 allow 与黑名单 block）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.listHostFilters();
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_list_host_filters',
    });
  },
});
