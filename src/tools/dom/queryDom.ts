/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {ElementInfo, QueryDomParams, QueryDomResult} from './types.js';

/**
 * 通过 CSS 选择器查询 DOM 元素。
 *
 * 在 Puppeteer Frame 中注入查询代码，返回匹配元素的结构化信息。
 * 默认查询第一个匹配元素（querySelector），设置 all=true 时查询所有匹配元素。
 *
 * @param frame - Puppeteer Frame 对象，用于注入查询代码
 * @param params - 查询参数
 * @returns 结构化结果对象
 */
export async function queryDom(
  frame: Frame,
  params: QueryDomParams,
): Promise<QueryDomResult> {
  const {selector, all = false, limit = 50} = params;
  const tooltype = 'query_dom';

  try {
    if (all) {
      const elements = await frame.evaluate(queryAllCode, selector, limit);
      return {
        success: true,
        message: `查询到 ${elements.length} 个匹配元素：${selector}`,
        tooltype,
        logFormat: 'full',
        data: elements,
      };
    }

    const element = await frame.evaluate(queryOneCode, selector);
    if (!element.found) {
      return {
        success: true,
        message: `未找到匹配元素：${selector}`,
        tooltype,
        logFormat: 'compact',
        data: element,
      };
    }
    return {
      success: true,
      message: `查询到匹配元素：${selector}`,
      tooltype,
      logFormat: 'full',
      data: element,
    };
  } catch (error) {
    return {
      success: false,
      message: `查询失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}

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
function queryAllCode(selector: string, maxLimit: number): ElementInfo[] {
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
