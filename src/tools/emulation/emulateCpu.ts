/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {EmulateCpuParams, EmulateCpuResult} from './types.js';

/**
 * 模拟 CPU 节流（降频）。
 *
 * 在 Puppeteer Frame 对应的 Page 上设置 CPU 降频倍率，
 * 用于检测竞态条件和时序相关问题。
 *
 * @param frame - Puppeteer Frame 对象，用于获取 Page 并设置 CPU 节流
 * @param params - CPU 节流参数
 * @returns 结构化结果对象
 */
export async function emulateCpu(
  frame: Frame,
  params: EmulateCpuParams,
): Promise<EmulateCpuResult> {
  const {throttlingRate} = params;
  const tooltype = 'emulate_cpu';
  const page = frame.page();

  if (throttlingRate < 1 || throttlingRate > 20) {
    return {
      success: false,
      message: 'CPU 降频倍率必须在 1-20 之间',
      tooltype,
    };
  }

  try {
    await page.emulateCPUThrottling(throttlingRate);
    return {
      success: true,
      message: `CPU 降频已设置为 ${throttlingRate}x`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `CPU 降频设置失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
