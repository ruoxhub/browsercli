/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {PredefinedNetworkConditions} from '../../third_party/index.js';

import type {Frame} from './types.js';
import type {
  EmulateNetworkParams,
  EmulateNetworkResult,
} from './types.js';

/**
 * 模拟网络条件（节流/离线模式）。
 *
 * 在 Puppeteer Frame 对应的 Page 上设置网络节流条件，
 * 返回结构化结果对象。
 *
 * @param frame - Puppeteer Frame 对象，用于获取 Page 并设置网络条件
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
    if (throttlingOption === 'No emulation') {
      await page.emulateNetworkConditions(null);
      return {
        success: true,
        message: '网络模拟已关闭',
        tooltype,
        logFormat: 'simple',
      };
    }

    if (throttlingOption === 'Offline') {
      await page.emulateNetworkConditions({
        offline: true,
        download: 0,
        upload: 0,
        latency: 0,
      });
      return {
        success: true,
        message: '网络模拟已设置为离线模式',
        tooltype,
        logFormat: 'simple',
      };
    }

    if (throttlingOption in PredefinedNetworkConditions) {
      await page.emulateNetworkConditions(
        PredefinedNetworkConditions[
          throttlingOption as keyof typeof PredefinedNetworkConditions
        ],
      );
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
