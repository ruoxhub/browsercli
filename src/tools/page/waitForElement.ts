/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';

import type {
  ElementInfo,
  WaitForElementParams,
  WaitForElementResult,
} from './types.js';

/**
 * 等待选择器对应的元素出现在页面中（纯函数版本）。
 *
 * 等待元素出现后返回元素的结构化信息。
 *
 * @param params - 等待参数（selector, timeout）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function waitForElement(
  params: WaitForElementParams,
): Promise<WaitForElementResult> {
  try {
    const page = await getRuntime().contextProvider!.getActivePage();

    await page.waitForSelector(params.selector, {
      timeout: params.timeout ?? 30000,
    });

    const element = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return null;

      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: el.className || undefined,
        textContent: el.textContent?.trim().substring(0, 100) || undefined,
        attributes: Array.from(el.attributes).reduce(
          (acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          },
          {} as Record<string, string>,
        ),
      };
    }, params.selector);

    return {
      success: true,
      message: `元素已出现: ${params.selector}`,
      tooltype: 'wait_for_element',
      logFormat: 'json',
      data: {
        selector: params.selector,
        appeared: true,
        element: element as ElementInfo | null,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `等待元素超时: ${params.selector}`,
      tooltype: 'wait_for_element',
      logFormat: 'json',
      data: {
        selector: params.selector,
        appeared: false,
        element: null,
      },
    };
  }
}
