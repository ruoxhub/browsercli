/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearMitmRequests = defineTool({
  name: 'clear_mitm_requests',
  description: '清空 MITM 代理捕获的所有请求。清空后 id 从 1 重新编号。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.clear();
    response.setStructuredContent({
      ...result,
      tooltype: 'clear_mitm_requests',
    });
  },
});
