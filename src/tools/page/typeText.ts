/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  TypeTextParams,
  TypeTextResult,
} from './types.js';

/**
 * 在输入元素中键入文本（纯函数版本）。
 *
 * 通过 CSS 选择器定位输入框并逐字输入。
 *
 * @param params - 输入参数（selector, text, delay）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function typeText(
  params: TypeTextParams,
): Promise<TypeTextResult> {
  try {
    if (!params?.selector || !params?.text) {
      return {
        success: false,
        message: 'type_text requires "selector" and "text" parameters',
        tooltype: 'type_text',
        logFormat: 'json',
        data: {
          selector: params?.selector ?? '',
          textLength: 0,
          typed: false,
        },
      };
    }

    const page = await getRuntime().contextProvider!.getActivePage();
    // Playwright: page.type(selector, text, options) - compatible
    // But prefer page.fill() for direct input, page.type() for char-by-char
    await page.type(params.selector, params.text, {
      delay: params.delay,
    });

    return {
      success: true,
      message: `文本已输入: ${params.selector}`,
      tooltype: 'type_text',
      logFormat: 'json',
      data: {
        selector: params.selector,
        textLength: params.text.length,
        typed: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `输入文本失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'type_text',
      logFormat: 'json',
      data: {
        selector: params.selector,
        textLength: params.text.length,
        typed: false,
      },
    };
  }
}
