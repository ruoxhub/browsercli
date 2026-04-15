/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod, PredefinedNetworkConditions} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

const throttlingOptions: [string, ...string[]] = [
  'No emulation',
  'Offline',
  ...Object.keys(PredefinedNetworkConditions),
];

interface DeviceProfile {
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
  };
  userAgent: string;
}

const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  android: {
    viewport: {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    },
    userAgent:
      'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  ipad: {
    viewport: {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  iphone: {
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
};

const DESKTOP_VIEWPORT = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

/**
 * 模拟网络条件（节流/离线模式）
 */
export const emulateNetwork = defineTool({
  name: 'emulate_network',
  description: `Emulates network conditions such as throttling or offline mode on the selected page. Available options: ${throttlingOptions.join(', ')}`,
  annotations: {
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
    title: 'Emulate network conditions',
  },
  schema: {
    throttlingOption: zod
      .enum(throttlingOptions)
      .describe(
        `The network throttling option to emulate. Set to "No emulation" to disable. Set to "Offline" to simulate offline network conditions.`,
      ),
  },
  handler: async (request, response, context, runtime) => {
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
      await page.emulateNetworkConditions(
        PredefinedNetworkConditions[
          conditions as keyof typeof PredefinedNetworkConditions
        ],
      );
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
    title: 'Emulate CPU throttling',
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
  handler: async (request, response, context, runtime) => {
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
    title: 'Resize browser window dimensions',
  },
  schema: {
    width: zod.number().describe('Page width in pixels'),
    height: zod.number().describe('Page height in pixels'),
  },
  handler: async (request, response, context, runtime) => {
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

/**
 * 一键切换移动设备模式（viewport + user-agent + touch）
 */
export const emulateMobile = defineTool({
  name: 'emulate_mobile',
  description: `Emulates mobile device viewport, user-agent, and touch events. Use this to test mobile layouts and touch interactions.`,
  annotations: {
    category: ToolCategory.EMULATION,
    readOnlyHint: false,
    title: 'Emulate mobile device viewport',
  },
  schema: {
    enable: zod
      .boolean()
      .describe('Whether to enable or disable mobile emulation'),
    device: zod
      .enum(['iphone', 'android', 'ipad'])
      .optional()
      .describe('Optional device type to emulate (default: iphone)'),
  },
  handler: async (request, response, context, runtime) => {
    const page = await runtime.collector.getActivePage();

    if (request.params.enable) {
      const profile = DEVICE_PROFILES[request.params.device || 'iphone'];
      await page.setViewport(profile.viewport);
      await page.setUserAgent(profile.userAgent);
      await page.setJavaScriptEnabled(true);
      response.appendResponseLine(
        `Mobile emulation enabled (${request.params.device || 'iphone'})`,
      );
      response.appendResponseLine(
        `Viewport: ${profile.viewport.width}x${profile.viewport.height}`,
      );
      response.appendResponseLine(
        `User-Agent: ${profile.userAgent.slice(0, 80)}...`,
      );
    } else {
      await page.setViewport(DESKTOP_VIEWPORT);
      await page.setUserAgent('');
      response.appendResponseLine('Mobile emulation disabled');
    }
  },
});
