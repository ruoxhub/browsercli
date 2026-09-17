/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  readSnapshot,
  type SnapshotNode,
} from '../../modules/dom/SnapshotReader.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {logger} from '../../utils/logger.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {defineTool, type Context} from '../ToolDefinition.js';

import type {ClickableElement} from './types.js';

/**
 * 查找页面中可点击的按钮和链接。
 *
 * 优先走 CDP 快照（穿透 shadow DOM、识别 JS 绑定的点击）；快照不可用时回退到
 * 当前 Frame 内的 JS 查询。支持按文本内容过滤。
 */
export const findClickableElements = defineTool({
  name: 'find_clickable_elements',
  description:
    '查找当前页面中可点击的按钮与链接，可按文本内容过滤，返回选择器、文本、类型、可见性与包围盒。',
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
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'find_clickable_elements',
      });
    }

    // DOMSnapshot 在 page 级 session 上返回所有 frame 的 document，无法归属到选中 Frame，
    // 仅当选中主 Frame 时才用快照路径，否则保持 frame.evaluate 的原有作用域。
    const isMainFrame = frame === frame.page().mainFrame();
    let nodes: SnapshotNode[] = [];
    let degraded = !isMainFrame;
    if (isMainFrame) {
      try {
        nodes = await readSnapshot(frame.page());
      } catch (error) {
        logger.debug(
          'find_clickable_elements: snapshot read failed, falling back to JS heuristic',
          error,
        );
        degraded = true;
      }
    }

    try {
      const elements = degraded
        ? await frame.evaluate(findClickableCode, filterText)
        : mapNodesToClickable(nodes, filterText);
      response.setStructuredContent({
        success: true,
        message:
          `Found ${elements.length} clickable elements` +
          `${filterText ? ` (filtered: "${filterText}")` : ''}` +
          `${degraded ? ' (fallback: JS heuristic)' : ''}`,
        tooltype: 'find_clickable_elements',
        data: elements,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `Failed to find clickable elements: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'find_clickable_elements'},
      );
    }
  },
});

/** CSS 字符串转义，避免 React useId（#:r0:）或 Tailwind 类名（hover:bg-x）生成非法选择器。 */
function quoteAttribute(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 由快照节点生成 CSS 选择器；id/class 一律走属性选择器以保证转义正确。 */
function buildSelector(node: SnapshotNode): string {
  const id = node.attributes.id;
  if (id) return `[id=${quoteAttribute(id)}]`;
  const firstClass = (node.attributes.class ?? '')
    .split(/\s+/)
    .filter(Boolean)[0];
  if (firstClass) return `[class~=${quoteAttribute(firstClass)}]`;
  return node.tagName;
}

/** 保持 ClickableElement 契约不变：a → link，其余 → button；不可见元素同样返回并用 visible 标记。 */
function mapNodesToClickable(
  nodes: SnapshotNode[],
  filterText?: string,
): ClickableElement[] {
  const lowered = filterText?.toLowerCase();
  const elements: ClickableElement[] = [];
  for (const node of nodes) {
    // 快照覆盖所有 frame，但选择器与坐标都以外层文档为基准，iframe 内节点不可用
    if (node.inIframe || !node.isInteractive) continue;
    if (lowered && !node.text.toLowerCase().includes(lowered)) continue;
    elements.push({
      selector: buildSelector(node),
      text: node.text,
      type: node.tagName === 'a' ? 'link' : 'button',
      visible: node.isVisible,
      boundingBox: node.bounds,
    });
  }
  return elements;
}

/** 注入代码：查找可点击元素 */
function findClickableCode(filter?: string): ClickableElement[] {
  const results: ClickableElement[] = [];
  const elements = document.querySelectorAll('*');

  elements.forEach(element => {
    const style = window.getComputedStyle(element);
    const tagName = element.tagName.toLowerCase();
    const clickable =
      tagName === 'button' ||
      (tagName === 'a' && element.hasAttribute('href')) ||
      (tagName === 'input' &&
        ['button', 'submit'].includes(
          (element as HTMLInputElement).type.toLowerCase(),
        )) ||
      element.hasAttribute('onclick') ||
      element.getAttribute('role')?.toLowerCase() === 'button' ||
      style.cursor === 'pointer';
    if (!clickable) return;

    const text =
      element.textContent?.trim() || (element as HTMLInputElement).value || '';
    if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0;

    let selector = tagName;
    if (element.id) {
      selector = `#${element.id}`;
    } else if (typeof element.className === 'string' && element.className) {
      selector = `${tagName}.${element.className.split(' ')[0]}`;
    }

    results.push({
      selector,
      text,
      type: tagName === 'a' ? 'link' : 'button',
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
