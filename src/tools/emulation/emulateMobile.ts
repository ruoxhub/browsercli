/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {
  DeviceProfileData,
  DeviceType,
  EmulateMobileParams,
  EmulateMobileResult,
} from './types.js';

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

/**
 * 一键切换移动设备模式（viewport + user-agent + touch）。
 *
 * 在 Playwright Frame 对应的 Page 上模拟移动设备视口、
 * User-Agent 和触摸事件，或恢复桌面模式。
 * Playwright 不支持 page 级别的 setUserAgent/setViewport 完整参数，
 * 因此使用 CDP 设置 UA，setViewportSize 设置视口尺寸。
 *
 * @param frame - Playwright Frame 对象，用于获取 Page 并设置设备模拟
 * @param params - 移动设备模拟参数
 * @returns 结构化结果对象
 */
export async function emulateMobile(
  frame: Frame,
  params: EmulateMobileParams,
): Promise<EmulateMobileResult> {
  const {enable, device = 'iphone'} = params;
  const tooltype = 'emulate_mobile';
  const page = frame.page();

  try {
    if (enable) {
      const profile = DEVICE_PROFILES[device];
      if (!profile) {
        return {
          success: false,
          message: `未知的设备类型：${device}，支持：iphone, android, ipad`,
          tooltype,
        };
      }

      // Playwright: setViewportSize only supports width/height
      await page.setViewportSize({
        width: profile.viewport.width,
        height: profile.viewport.height,
      });

      // Playwright: setUserAgent is not available on Page, use CDP
      const client = await page.context().newCDPSession(page);
      await client.send('Network.setUserAgentOverride', {
        userAgent: profile.userAgent,
      });

      return {
        success: true,
        message: `移动设备模拟已启用 (${device})`,
        tooltype,
        logFormat: 'simple',
        data: {
          device,
          viewport: {
            width: profile.viewport.width,
            height: profile.viewport.height,
          },
          userAgent: profile.userAgent.slice(0, 80) + '...',
        },
      };
    }

    // 关闭移动模拟，恢复桌面模式
    await page.setViewportSize({
      width: DESKTOP_VIEWPORT.width,
      height: DESKTOP_VIEWPORT.height,
    });

    // Reset UA via CDP (empty string resets to default)
    const client = await page.context().newCDPSession(page);
    await client.send('Network.setUserAgentOverride', {
      userAgent: '',
    });

    return {
      success: true,
      message: '移动设备模拟已关闭',
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `移动设备模拟失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}

/** 导出设备配置供外部使用 */
export {DEVICE_PROFILES, DESKTOP_VIEWPORT};
