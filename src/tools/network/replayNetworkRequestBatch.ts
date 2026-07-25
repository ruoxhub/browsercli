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
    '以不同覆盖项（变体）多次重放一个捕获的网络请求。适用于模糊测试签名字段、测试参数边界、观察响应分布。默认串行执行，也支持有界并发。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    reqid: zod
      .number()
      .int()
      .positive()
      .describe('用作模板的已捕获请求的 reqid。'),
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
      .optional()
      .describe(
        '要应用的覆盖变体。每个变体产生一次重放。最多 50 个以控制运行时长。' +
          '省略时基于捕获到的原请求自动重放一次（单变体）。',
      ),
    concurrency: zod
      .number()
      .int()
      .min(1)
      .max(MAX_CONCURRENCY)
      .optional()
      .describe(
        '最大并行重放数。默认 1（串行）。值越大越可能触发服务端限流。',
      ),
    maxBodyLength: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        '每个响应体返回的最大长度。默认 500（因结果聚合，小于单次重放默认值）。',
      ),
  },
  handler: async (request, response) => {
    // variants 省略时，以单个空 override 重放原请求一次，
    // 使工具在无需构造复杂变体的情况下也可直接使用。
    const params: ReplayNetworkRequestBatchParams = {
      reqid: request.params.reqid,
      variants: request.params.variants ?? [{}],
      ...(request.params.concurrency !== undefined && {
        concurrency: request.params.concurrency,
      }),
      ...(request.params.maxBodyLength !== undefined && {
        maxBodyLength: request.params.maxBodyLength,
      }),
    };
    const result = await getRuntime().networkModule.replayBatch(
      getRuntime().contextProvider!,
      params,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'replay_network_request_batch',
    });
  },
});
