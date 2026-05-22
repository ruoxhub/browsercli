/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const DEVICE_PROFILES: Record<string, DeviceProfileData> = {
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

interface DeviceProfileData {
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
  };
  userAgent: string;
}

/**
 * 一键切换移动设备模式（viewport + user-agent + touch）。
 */
export const emulateMobile = defineTool({
  name: 'emulate_mobile',
  description: 'Emulate mobile device viewport, user-agent and touch events, or restore desktop mode',
  annotations: {category: ToolCategory.EMULATION, readOnlyHint: false},
  schema: {
    enable: zod.boolean().describe('Enable or disable mobile emulation'),
    device: zod
      .enum(['iphone', 'android', 'ipad'])
      .optional()
      .describe('Device preset (default: iphone)'),
  },
  handler: async (request, response, context) => {
    const {enable, device = 'iphone'} = request.params;
    const tooltype = 'emulate_mobile';
    const frame = context.getSelectedFrame();
    const page = frame.page();

    try {
      if (enable) {
        const profile = DEVICE_PROFILES[device];
        if (!profile) {
          response.appendResponseLine('```json');
          response.appendResponseLine(
            JSON.stringify(
              {
                success: false,
                message: `未知的设备类型：${device}，支持：iphone, android, ipad`,
                tooltype,
              },
              null,
              2,
            ),
          );
          response.appendResponseLine('```');
          return;
        }

        await page.setViewportSize({
          width: profile.viewport.width,
          height: profile.viewport.height,
        });

        const client = await page.context().newCDPSession(page);
        await client.send('Network.setUserAgentOverride', {
          userAgent: profile.userAgent,
        });

        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: true,
              message: `移动设备模拟已启用 (${device})`,
              tooltype,
              data: {
                device,
                viewport: {
                  width: profile.viewport.width,
                  height: profile.viewport.height,
                },
                userAgent: profile.userAgent.slice(0, 80) + '...',
              },
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
      }

      // 关闭移动模拟，恢复桌面模式
      await page.setViewportSize({
        width: DESKTOP_VIEWPORT.width,
        height: DESKTOP_VIEWPORT.height,
      });

      const client = await page.context().newCDPSession(page);
      await client.send('Network.setUserAgentOverride', {
        userAgent: '',
      });

      response.appendResponseLine('```json');
      response.appendResponseLine(
        JSON.stringify(
          {
            success: true,
            message: '移动设备模拟已关闭',
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
            message: `移动设备模拟失败：${error instanceof Error ? error.message : String(error)}`,
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

/** 导出设备配置供外部使用 */
export {DEVICE_PROFILES, DESKTOP_VIEWPORT};
