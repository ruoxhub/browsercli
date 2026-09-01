/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearHostFilters = defineTool({
  name: 'mitm_clear_host_filters',
  description: '清空全部 MITM 域名过滤（白名单与黑名单一起清）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.clearHostFilters();
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_clear_host_filters',
    });
  },
});
