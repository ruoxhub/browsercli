/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearNetworkRequests = defineTool({
  name: 'clear_network_requests',
  description:
    'Clear the cached network requests for the currently selected page (or a specified page). After clearing, the request list returned by list_network_requests will be empty and stable IDs will be reissued from 1.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Browser page index. When omitted, uses the currently active page.',
      ),
  },
  handler: async (request, response) => {
    const result = getRuntime().networkModule.clearRequests(
      getRuntime().contextProvider!,
      request.params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'clear_network_requests',
    });
  },
});
