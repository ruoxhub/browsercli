/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 模拟 CPU 节流（降频）。
 */
export const emulateCpu = defineTool({
  name: 'emulate_cpu',
  description: '通过 CDP Performance.setCPUThrottlingRate 模拟 CPU 节流。',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    throttlingRate: zod
      .number()
      .min(1)
      .max(20)
      .describe('CPU 节流倍率（1-20 倍）。'),
  },
  handler: async (request, response, context) => {
    const {throttlingRate} = request.params;
    const tooltype = 'emulate_cpu';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      const client = await page.context().newCDPSession(page);
      await (
        client.send as (
          method: string,
          params?: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      )('Emulation.setCPUThrottlingRate', {
        rate: throttlingRate,
      });
      response.setStructuredContent({
        success: true,
        message: `CPU 降频已设置为 ${throttlingRate}x`,
        tooltype,
        data: {rate: throttlingRate},
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `CPU 降频设置失败：${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'emulate_cpu', rate: throttlingRate},
      );
    }
  },
});
