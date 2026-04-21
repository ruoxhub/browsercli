/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {InjectHookResult} from './types.js';

/**
 * 向页面注入 Hook 脚本。
 *
 * 将预生成的 Hook 脚本注入到指定 Frame 中执行，
 * Hook 将立即开始监控/拦截目标 API。
 *
 * @param frame - Puppeteer Frame 对象，用于注入脚本
 * @param hookId - Hook 标识符（用于日志和追踪）
 * @param script - 要注入的 Hook 脚本代码
 * @returns 结构化结果对象
 */
export async function injectHook(
  frame: Frame,
  hookId: string,
  script: string,
): Promise<InjectHookResult> {
  try {
    await frame.evaluate(script);
    return {
      success: true,
      message: `Hook injected: ${hookId}`,
      tooltype: 'inject_hook',
      hookId,
    };
  } catch (error) {
    return {
      success: false,
      message: `注入失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'inject_hook',
      hookId,
    };
  }
}
