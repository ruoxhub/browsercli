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
    'List all requests for the currently selected page since the last navigation. Supports filtering by resource type, header keyword, pagination, and waiting for matching requests.',
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
        'Maximum number of requests to return. When omitted, returns all requests.',
      ),
    pageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Page number to return (0-based). When omitted, returns the first page.',
      ),
    resourceTypes: zod
      .array(zod.enum(FILTERABLE_RESOURCE_TYPES))
      .optional()
      .describe(
        'Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.',
      ),
    includePreservedRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Set to true to return the preserved requests over the last 3 navigations.',
      ),
    targetPageIdx: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Browser page index. When omitted, uses the currently active page.',
      ),
    waitForRequest: zod
      .string()
      .optional()
      .describe(
        'Wait for a request whose URL contains this fragment before returning.',
      ),
    waitTimeoutMs: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum time in milliseconds to wait for a matching request when waitForRequest is set.',
      ),
    headerFilter: zod
      .string()
      .optional()
      .describe(
        'Filter requests by a keyword present in their headers (case-insensitive).',
      ),
    urlFilter: zod
      .string()
      .optional()
      .describe(
        'Filter requests by a keyword present in their URL (case-insensitive).',
      ),
    includeSignatureEvidence: zod
      .boolean()
      .optional()
      .describe(
        'Include signature-related evidence correlations in the response.',
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
