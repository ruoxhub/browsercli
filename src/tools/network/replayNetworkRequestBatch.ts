/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';
import {
  buildReplayRequest,
  emptyReplayResponse,
  executeReplay,
} from './replayEngine.js';
import type {
  BatchVariantResult,
  GetNetworkRequestData,
  ReplayNetworkRequestBatchParams,
  ReplayOverride,
} from './types.js';

const DEFAULT_BATCH_MAX_BODY_LENGTH = 500;
const MAX_VARIANTS = 50;
const MAX_CONCURRENCY = 10;

function buildOriginalData(
  reqid: number,
  networkRequest: {
    url(): string;
    method(): string;
    postData(): string | null;
    resourceType(): string;
    headers(): Record<string, string>;
  },
  httpResponse: {
    status(): number;
    statusText?(): string;
    headers(): Record<string, string>;
  } | null,
): GetNetworkRequestData {
  return {
    reqid,
    url: networkRequest.url(),
    method: networkRequest.method(),
    resourceType: networkRequest.resourceType(),
    statusCode: httpResponse?.status() ?? 0,
    statusText: httpResponse?.statusText?.(),
    requestHeaders: networkRequest.headers(),
    responseHeaders: httpResponse?.headers() ?? {},
    postData: networkRequest.postData() ?? undefined,
  };
}

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
  handler: async (request, response, context) => {
    const params = request.params as ReplayNetworkRequestBatchParams;
    const reqid = params.reqid;
    const variants = params.variants;
    const concurrency = params.concurrency ?? 1;
    const maxBodyLength = params.maxBodyLength ?? DEFAULT_BATCH_MAX_BODY_LENGTH;

    try {
      const page = context.getSelectedPage();
      const networkRequest = context.getNetworkRequestById(reqid);
      const httpResponse = await networkRequest.response().catch(() => null);
      const originalData = buildOriginalData(
        reqid,
        networkRequest,
        httpResponse,
      );

      // Build all requests up front. Per-variant build errors are recorded, not thrown.
      const built: Array<{
        built: ReturnType<typeof buildReplayRequest>;
        override: ReplayOverride;
        buildError?: string;
      }> = [];
      for (let i = 0; i < variants.length; i++) {
        const override = variants[i];
        try {
          built.push({
            built: buildReplayRequest(originalData, override),
            override,
          });
        } catch (e) {
          built.push({
            built: {method: '', url: '', headers: {}},
            override,
            buildError: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const results: BatchVariantResult[] = new Array(variants.length);
      const queue = built.map((b, i) => ({...b, i}));
      const workers = Array.from(
        {length: Math.min(concurrency, variants.length)},
        async () => {
          while (queue.length > 0) {
            const next = queue.shift()!;
            if (next.buildError) {
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: emptyReplayResponse(next.built.url),
                error: next.buildError,
              };
              continue;
            }
            try {
              const r = await executeReplay(
                page.context().request,
                next.built,
                maxBodyLength,
              );
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: r,
              };
            } catch (e) {
              results[next.i] = {
                index: next.i,
                override: next.override,
                result: emptyReplayResponse(next.built.url),
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }
        },
      );
      await Promise.all(workers);

      let succeeded = 0;
      let failed = 0;
      const statusCodeDistribution: Record<number, number> = {};
      for (const r of results) {
        if (r.error) {
          failed++;
        } else {
          succeeded++;
        }
        const status = r.result.status;
        statusCodeDistribution[status] =
          (statusCodeDistribution[status] ?? 0) + 1;
      }

      response.setStructuredContent({
        success: failed === 0,
        message: `批量重放完成：${succeeded}/${variants.length} 成功`,
        tooltype: 'replay_network_request_batch',
        data: {
          total: variants.length,
          succeeded,
          failed,
          statusCodeDistribution,
          results,
        },
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `批量重放失败：${
          error instanceof Error ? error.message : String(error)
        }`,
        tooltype: 'replay_network_request_batch',
        data: {
          total: variants.length,
          succeeded: 0,
          failed: variants.length,
          statusCodeDistribution: {},
          results: [],
        },
      });
    }
  },
});
