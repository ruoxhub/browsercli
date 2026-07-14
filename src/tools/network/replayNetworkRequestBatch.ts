/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

import type {ReplayNetworkRequestBatchParams} from './types.js';

const MAX_VARIANTS = 50;
const MAX_CONCURRENCY = 10;

export const replayNetworkRequestBatch = defineTool({
  name: 'replay_network_request_batch',
  description:
    'Replay a captured network request multiple times with different overrides (variants). Useful for fuzzing signature fields, testing parameter boundaries, and observing response distribution. Sequential by default; bounded concurrency available.',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('The reqid of the captured request to use as the template.'),
    variants: zod
      .array(
        zod.object({
          method: zod.string().optional(),
          url: zod.string().optional(),
          headers: zod.record(zod.string(), zod.string()).optional(),
          body: zod.string().nullable().optional(),
          replaceHeaders: zod.boolean().optional(),
        }),
      )
      .min(1)
      .max(MAX_VARIANTS)
      .describe(
        'Override variants to apply. Each variant produces one replay. Max 50 to bound runtime.',
      ),
    concurrency: zod
      .number()
      .int()
      .min(1)
      .max(MAX_CONCURRENCY)
      .optional()
      .describe(
        'Max parallel replays. Default 1 (sequential). Higher values risk server-side rate limiting.',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum length of each response body to return. Defaults to 500 (smaller than single-replay default since results aggregate).',
      ),
  },
  handler: async (request, response) => {
    const result = await getRuntime().networkModule.replayBatch(
      getRuntime().contextProvider!,
      request.params as ReplayNetworkRequestBatchParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'replay_network_request_batch',
    });
  },
});
