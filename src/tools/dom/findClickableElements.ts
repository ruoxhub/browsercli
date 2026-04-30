/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {
  ClickableElement,
  FindClickableElementsParams,
  FindClickableElementsResult,
} from './types.js';

/**
 * 查找页面中可点击的按钮和链接。
 *
 * 在 Playwright Frame 中注入查询代码，返回所有可点击元素的结构化信息。
 * 支持按文本内容过滤。
 *
 * @param frame - Playwright Frame 对象，用于注入查询代码
 * @param params - 查询参数
 * @returns 结构化结果对象
 */
export async function findClickableElements(
  frame: Frame,
  params: FindClickableElementsParams = {},
): Promise<FindClickableElementsResult> {
  const {filterText} = params;
  const tooltype = 'find_clickable_elements';

  try {
    const elements = await frame.evaluate(findClickableCode, filterText);

    return {
      success: true,
      message: `找到 ${elements.length} 个可点击元素${filterText ? `（过滤：${filterText}）` : ''}`,
      tooltype,
      logFormat: 'full',
      data: elements,
    };
  } catch (error) {
    return {
      success: false,
      message: `查找可点击元素失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}

/** 注入代码：查找可点击元素 */
function findClickableCode(filter?: string): ClickableElement[] {
  const results: ClickableElement[] = [];

  // 查找按钮
  const buttons = document.querySelectorAll(
    'button, input[type="button"], input[type="submit"]',
  );
  buttons.forEach(btn => {
    const text =
      btn.textContent?.trim() || (btn as HTMLInputElement).value || '';
    if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
      return;
    }

    const rect = btn.getBoundingClientRect();
    const style = window.getComputedStyle(btn);
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0;

    let selector = btn.tagName.toLowerCase();
    if (btn.id) {
      selector = `#${btn.id}`;
    } else if (btn.className) {
      selector = `${btn.tagName.toLowerCase()}.${btn.className.split(' ')[0]}`;
    }

    results.push({
      selector,
      text,
      type: 'button',
      visible,
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
  });

  // 查找链接
  const links = document.querySelectorAll('a[href]');
  links.forEach(link => {
    const text = link.textContent?.trim() || '';
    if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
      return;
    }

    const rect = link.getBoundingClientRect();
    const style = window.getComputedStyle(link);
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0;

    let selector = 'a';
    if (link.id) {
      selector = `#${link.id}`;
    } else if (link.className) {
      selector = `a.${link.className.split(' ')[0]}`;
    }

    results.push({
      selector,
      text,
      type: 'link',
      visible,
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
  });

  return results;
}
