/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import type {ElementInfo} from './types.js';

/**
 * 通过定位器查询 DOM 元素。
 *
 * 在当前 Frame 中注入查询代码，返回匹配元素的结构化信息。
 * 默认查询第一个匹配元素（querySelector），设置 all=true 时查询所有匹配元素。
 */
export const queryDom = defineTool({
  name: 'query_dom',
  description:
    '通过定位器查询一个或多个 DOM 元素，返回包含标签、属性、包围盒与可见性的结构化信息。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '查询DOM元素',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。不可与 CSS 逗号混写。',
      ),
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
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'query_dom',
      });
    }

    try {
      const locator = frame.locator(selector);

      if (all) {
        const elements = await locator.evaluateAll(queryAllCode, limit);
        response.setStructuredContent({
          success: true,
          message: `Query returned ${elements.length} matching elements`,
          tooltype: 'query_dom',
          data: {elements, selector, count: elements.length},
        });
        return;
      }

      const count = await locator.count();
      if (count === 0) {
        response.setStructuredContent({
          success: true,
          message: `No matching element found: ${selector}`,
          tooltype: 'query_dom',
          data: null,
        });
        return;
      }

      const element = await locator.first().evaluate(queryOneCode);
      response.setStructuredContent({
        success: true,
        message: element.found
          ? `Found matching element: ${selector}`
          : `No matching element found: ${selector}`,
        tooltype: 'query_dom',
        data: element.found ? element : null,
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'query_dom', selector});
    }
  },
});

/** 注入代码：提取单个元素信息 */
function queryOneCode(element: Element): ElementInfo {
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

/** 注入代码：提取多个元素信息 */
function queryAllCode(nodeList: Element[], maxLimit: number): ElementInfo[] {
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
