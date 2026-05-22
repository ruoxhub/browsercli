/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 模拟 CPU 节流（降频）。
 */
export const emulateCpu = defineTool({
  name: 'emulate_cpu',
  description: 'Emulate CPU throttling via CDP Performance.setCPUThrottlingRate',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    throttlingRate: zod
      .number()
      .min(1)
      .max(20)
      .describe('CPU throttling rate (1-20x)'),
  },
  handler: async (request, response, context) => {
    const {throttlingRate} = request.params;
    const tooltype = 'emulate_cpu';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      const client = await page.context().newCDPSession(page);
      await client.send('Performance.enable');
      await (client.send as (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>)('Performance.setCPUThrottlingRate', {
        rate: throttlingRate,
      });
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: `CPU 降频已设置为 ${throttlingRate}x`,
            tooltype,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    } catch (error) {
      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `CPU 降频设置失败：${error instanceof Error ? error.message : String(error)}`,
            tooltype,
          },
          null,
          2,
        ),
      );
      response.appendResponseLine('```');
    }
  },
});
