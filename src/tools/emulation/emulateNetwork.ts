/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/** 预定义网络条件 */
const PREDEFINED_NETWORK_CONDITIONS: Record<
  string,
  {
    offline: boolean;
    downloadThroughput: number;
    uploadThroughput: number;
    latency: number;
  }
> = {
  'Slow 3G': {
    offline: false,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
    latency: 2000,
  },
  'Fast 3G': {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 562.5,
  },
  '4G': {
    offline: false,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (9 * 1024 * 1024) / 8,
    latency: 170,
  },
  WiFi: {
    offline: false,
    downloadThroughput: (30 * 1024 * 1024) / 8,
    uploadThroughput: (15 * 1024 * 1024) / 8,
    latency: 2,
  },
};

/**
 * 模拟网络条件（节流/离线模式）。
 */
export const emulateNetwork = defineTool({
  name: 'emulate_network',
  description: 'Emulate network conditions (throttling/offline) via CDP Network.emulateNetworkConditions',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    throttlingOption: zod
      .string()
      .describe(
        'Network throttling option: "No emulation", "Offline", "Slow 3G", "Fast 3G", "4G", "WiFi"',
      ),
  },
  handler: async (request, response, context) => {
    const {throttlingOption} = request.params;
    const tooltype = 'emulate_network';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      const client = await page.context().newCDPSession(page);

      if (throttlingOption === 'No emulation') {
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {success: true, message: '网络模拟已关闭', tooltype},
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      if (throttlingOption === 'Offline') {
        await client.send('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {success: true, message: '网络模拟已设置为离线模式', tooltype},
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      if (throttlingOption in PREDEFINED_NETWORK_CONDITIONS) {
        const conditions = PREDEFINED_NETWORK_CONDITIONS[throttlingOption];
        await client.send('Network.emulateNetworkConditions', conditions);
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: true,
              message: `网络模拟已设置为：${throttlingOption}`,
              tooltype,
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: false,
            message: `未知的网络节流选项：${throttlingOption}`,
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
            message: `网络模拟失败：${error instanceof Error ? error.message : String(error)}`,
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
