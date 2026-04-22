/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {
  EmulateNetworkParams,
  EmulateNetworkResult,
} from './types.js';

/** 预定义网络条件（Playwright 无此 API，手动定义） */
const PREDEFINED_NETWORK_CONDITIONS: Record<string, {
  offline: boolean;
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
}> = {
  'Slow 3G': {
    offline: false,
    downloadThroughput: 500 * 1024 / 8,
    uploadThroughput: 500 * 1024 / 8,
    latency: 2000,
  },
  'Fast 3G': {
    offline: false,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
    latency: 562.5,
  },
  '4G': {
    offline: false,
    downloadThroughput: 9 * 1024 * 1024 / 8,
    uploadThroughput: 9 * 1024 * 1024 / 8,
    latency: 170,
  },
  'WiFi': {
    offline: false,
    downloadThroughput: 30 * 1024 * 1024 / 8,
    uploadThroughput: 15 * 1024 * 1024 / 8,
    latency: 2,
  },
};

/**
 * 模拟网络条件（节流/离线模式）。
 *
 * 通过 CDP Network.emulateNetworkConditions 在 Playwright Frame 对应的 Page 上设置网络节流条件，
 * 返回结构化结果对象。
 *
 * @param frame - Playwright Frame 对象，用于获取 Page 并设置网络条件
 * @param params - 网络模拟参数
 * @returns 结构化结果对象
 */
export async function emulateNetwork(
  frame: Frame,
  params: EmulateNetworkParams,
): Promise<EmulateNetworkResult> {
  const {throttlingOption} = params;
  const tooltype = 'emulate_network';
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
      return {
        success: true,
        message: '网络模拟已关闭',
        tooltype,
        logFormat: 'simple',
      };
    }

    if (throttlingOption === 'Offline') {
      await client.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      return {
        success: true,
        message: '网络模拟已设置为离线模式',
        tooltype,
        logFormat: 'simple',
      };
    }

    if (throttlingOption in PREDEFINED_NETWORK_CONDITIONS) {
      const conditions = PREDEFINED_NETWORK_CONDITIONS[throttlingOption];
      await client.send('Network.emulateNetworkConditions', conditions);
      return {
        success: true,
        message: `网络模拟已设置为：${throttlingOption}`,
        tooltype,
        logFormat: 'simple',
      };
    }

    return {
      success: false,
      message: `未知的网络节流选项：${throttlingOption}`,
      tooltype,
    };
  } catch (error) {
    return {
      success: false,
      message: `网络模拟失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
