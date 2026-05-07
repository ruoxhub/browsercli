/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {defineTool, type Context} from '../ToolDefinition.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';

import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';

import type {ElementInfo} from './types.js';

/**
 * 通过 CSS 选择器查询 DOM 元素。
 *
 * 在当前 Frame 中注入查询代码，返回匹配元素的结构化信息。
 * 默认查询第一个匹配元素（querySelector），设置 all=true 时查询所有匹配元素。
 */
export const queryDom = defineTool({
  name: 'query_dom',
  description:
    'Query one or multiple DOM elements by CSS selector. Returns structured element info including tag, attributes, bounding box, and visibility.',
  annotations: {
    title: '查询DOM元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe('CSS 选择器，如 "#app"、".btn-primary"、"div[data-role=main]"'),
    all: zod
      .boolean()
      .optional()
      .describe('是否查询所有匹配元素（默认 false，仅查询第一个）'),
    limit: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('查询所有时的最大返回数量（默认 50）'),
  },
  handler: async (request, response, context) => {
    const {selector, all = false, limit = 50} = request.params;
    const frame = (context as Context).getSelectedFrame();

    if (!frame) {
      response.setStructuredContent({
        success: false,
        message: NO_ACTIVE_PAGE_MESSAGE,
        tooltype: 'query_dom',
        data: null,
      });
      return;
    }

    try {
      if (all) {
        const elements = await frame.evaluate(queryAllCode, {selector, limit});
        response.setStructuredContent({
          success: true,
          message: `Query returned ${elements.length} matching elements`,
          tooltype: 'query_dom',
          data: {elements, selector, count: elements.length},
        });
        return;
      }

      const element = await frame.evaluate(queryOneCode, selector);
      response.setStructuredContent({
        success: element.found,
        message: element.found
          ? `Found matching element: ${selector}`
          : `No matching element found: ${selector}`,
        tooltype: 'query_dom',
        data: element.found ? element : null,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'query_dom',
        data: null,
      });
    }
  },
});

/** 注入代码：查询单个元素 */
function queryOneCode(selector: string): ElementInfo {
  const element = document.querySelector(selector);
  if (!element) {
    return {found: false};
  }

  const attributes: Record<string, string> = {};
  const attrs = element.attributes;
  for (const attr of Array.from(attrs)) {
    if (attr) {
      attributes[attr.name] = attr.value;
    }
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const visible =
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0';

  return {
    found: true,
    nodeName: element.nodeName,
    attributes,
    textContent: element.textContent?.trim() || '',
    boundingBox: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    visible,
  };
}

/** 注入代码：查询多个元素 */
function queryAllCode({
  selector,
  limit: maxLimit,
}: {
  selector: string;
  limit: number;
}): ElementInfo[] {
  const nodeList = document.querySelectorAll(selector);
  const results: ElementInfo[] = [];

  for (let i = 0; i < Math.min(nodeList.length, maxLimit); i++) {
    const element = nodeList[i];
    if (!element) continue;

    const attributes: Record<string, string> = {};
    const attrs = element.attributes;
    for (const attr of Array.from(attrs)) {
      if (attr) {
        attributes[attr.name] = attr.value;
      }
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const textContent = element.textContent?.trim() || '';
    const truncatedText =
      textContent.length > 500
        ? textContent.substring(0, 500) + '...[truncated]'
        : textContent;

    results.push({
      found: true,
      nodeName: element.nodeName,
      attributes,
      textContent: truncatedText,
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      visible:
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0',
    });
  }

  return results;
}
