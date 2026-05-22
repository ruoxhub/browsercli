/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import type {ClickableElement} from './types.js';

/**
 * 查找页面中可点击的按钮和链接。
 *
 * 在当前 Frame 中注入查询代码，返回所有可点击元素的结构化信息。
 * 支持按文本内容过滤。
 */
export const findClickableElements = defineTool({
  name: 'find_clickable_elements',
  description:
    'Find clickable buttons and links on the current page. Optionally filter by text content. Returns selector, text, type, visibility, and bounding box.',
  annotations: {
    title: '查找可点击元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    filterText: zod
      .string()
      .optional()
      .describe('按文本内容过滤（可选，不区分大小写）'),
  },
  handler: async (request, response, context) => {
    const {filterText} = request.params;
    const frame = (context as Context).getSelectedFrame();

    if (!frame) {
      response.setStructuredContent({
        success: false,
        message: NO_ACTIVE_PAGE_MESSAGE,
        tooltype: 'find_clickable_elements',
        data: null,
      });
      return;
    }

    try {
      const elements = await frame.evaluate(findClickableCode, filterText);
      response.setStructuredContent({
        success: true,
        message: `Found ${elements.length} clickable elements${filterText ? ` (filtered: "${filterText}")` : ''}`,
        tooltype: 'find_clickable_elements',
        data: elements,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Failed to find clickable elements: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'find_clickable_elements',
        data: null,
      });
    }
  },
});

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
