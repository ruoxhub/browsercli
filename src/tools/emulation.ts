/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod, PredefinedNetworkConditions} from '../third_party/index.js';
import {defineTool} from './ToolDefinition.js';
import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';

const throttlingOptions: [string, ...string[]] = [
  'No emulation',
  'Offline',
  ...Object.keys(PredefinedNetworkConditions),
];

/**
 * 模拟网络条件（节流/离线模式）
 */
export const emulateNetwork = defineTool({
  name: 'emulate_network',
  description: `Emulates network conditions such as throttling or offline mode on the selected page. Available options: ${throttlingOptions.join(', ')}`,
  annotations: {
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
  },
  schema: {
    throttlingOption: zod
      .enum(throttlingOptions)
      .describe(
        `The network throttling option to emulate. Set to "No emulation" to disable. Set to "Offline" to simulate offline network conditions.`,
      ),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();
    const conditions = request.params.throttlingOption;

    if (conditions === 'No emulation') {
      await page.emulateNetworkConditions(null);
      response.appendResponseLine('Network emulation disabled');
      return;
    }

    if (conditions === 'Offline') {
      await page.emulateNetworkConditions({
        offline: true,
        download: 0,
        upload: 0,
        latency: 0,
      });
      response.appendResponseLine('Network emulation set to Offline mode');
      return;
    }

    if (conditions in PredefinedNetworkConditions) {
      const networkCondition =
        PredefinedNetworkConditions[
          conditions as keyof typeof PredefinedNetworkConditions
        ];
      await page.emulateNetworkConditions(networkCondition);
      response.appendResponseLine(`Network emulation set to: ${conditions}`);
    }
  },
});

/**
 * 模拟 CPU 节流（降频）
 */
export const emulateCpu = defineTool({
  name: 'emulate_cpu',
  description: `Emulates CPU throttling by slowing down the selected page's execution. Useful for detecting race conditions and timing-dependent issues.`,
  annotations: {
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
  },
  schema: {
    throttlingRate: zod
      .number()
      .min(1)
      .max(20)
      .describe(
        'The CPU throttling rate representing the slowdown factor 1-20x. Set the rate to 1 to disable throttling',
      ),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();
    const {throttlingRate} = request.params;

    await page.emulateCPUThrottling(throttlingRate);
    response.appendResponseLine(`CPU throttling set to ${throttlingRate}x`);
  },
});

/**
 * 调整页面窗口尺寸
 */
export const resizePage = defineTool({
  name: 'resize_page',
  description: `Resizes the browser window so that the page has specified dimensions. Useful for testing responsive layouts and mobile views.`,
  annotations: {
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
  },
  schema: {
    width: zod.number().describe('Page width in pixels'),
    height: zod.number().describe('Page height in pixels'),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();

    await page.setViewport({
      width: request.params.width,
      height: request.params.height,
    });

    response.appendResponseLine(
      `Page resized to ${request.params.width}x${request.params.height}`,
    );
  },
});
