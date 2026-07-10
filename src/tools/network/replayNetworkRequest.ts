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
    "Replay a captured network request (by reqid) using the browser context's cookies and storage. Supports overriding method, url, headers, and body. Useful for verifying signature field effects and parameter validity.",
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
        'The reqid of the captured network request to replay. Use list_network_requests to find it.',
      ),
    method: zod
      .string()
      .optional()
      .describe(
        'Override the HTTP method (e.g. POST, GET). Defaults to the original method.',
      ),
    url: zod
      .string()
      .optional()
      .describe('Override the request URL. Defaults to the original URL.'),
    headers: zod
      .record(zod.string(), zod.string())
      .optional()
      .describe(
        'Headers to merge with the original (override wins on key collision, case-insensitive). Set replaceHeaders=true to replace wholesale.',
      ),
    body: zod
      .string()
      .nullable()
      .optional()
      .describe(
        'Override the request body. null clears the body. Omit to keep the original. Only meaningful for POST/PUT/PATCH.',
      ),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        'If true, the headers param replaces the original headers entirely. Default false (merge).',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum length of the response body to return. Defaults to 2000 characters.',
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
