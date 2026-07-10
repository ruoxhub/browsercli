/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import type {ExportRequestAsCurlParams} from './types.js';

export const exportRequestAsCurl = defineTool({
  name: 'export_request_as_curl',
  description:
    'Export a captured network request (by reqid) as a curl command. Supports the same overrides as replay_network_request. Useful for reproducing a request outside the browser or verifying that an exported command reproduces the captured response.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('The reqid of the captured network request to export.'),
    method: zod.string().optional().describe('Override the HTTP method.'),
    url: zod.string().optional().describe('Override the request URL.'),
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
      .describe('Override the request body. null clears the body.'),
    replaceHeaders: zod
      .boolean()
      .optional()
      .describe(
        'If true, the headers param replaces the original headers entirely. Default false (merge).',
      ),
    includeCookies: zod
      .boolean()
      .optional()
      .describe(
        'If true, embed cookies from the browser context as a Cookie header in the curl command. Default false (cookies are session-bound and may be sensitive).',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.exportCurl(
      getRuntime().contextProvider!,
      request.params as ExportRequestAsCurlParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'export_request_as_curl',
    });
  },
});
