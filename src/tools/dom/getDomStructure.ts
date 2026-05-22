/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {NO_ACTIVE_PAGE_MESSAGE} from '../shared/activePageResolver.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 获取页面 DOM 树结构。
 *
 * 在当前 Frame 中注入遍历代码，返回指定深度的 DOM 树结构。
 * 可选包含文本内容，便于 AI 理解页面布局。
 */
export const getDomStructure = defineTool({
  name: 'get_dom_structure',
  description:
    'Get DOM tree structure for the current page. Returns a hierarchical tree with tag names, IDs, classes, and optional text content.',
  annotations: {
    title: '获取DOM结构',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    maxDepth: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe('DOM 树最大深度（默认 3）'),
    includeText: zod
      .boolean()
      .optional()
      .describe('是否包含文本内容（默认 true）'),
  },
  handler: async (request, response, context) => {
    const {maxDepth = 3, includeText = true} = request.params;
    const frame = (context as Context).getSelectedFrame();

    if (!frame) {
      response.setStructuredContent({
        success: false,
        message: NO_ACTIVE_PAGE_MESSAGE,
        tooltype: 'get_dom_structure',
        data: null,
      });
      return;
    }

    try {
      const structure = await frame.evaluate(
        ({depth, withText}) => {
          function buildTree(
            node: Element,
            currentDepth: number,
          ): Record<string, unknown> | null {
            if (currentDepth > depth) {
              return null;
            }

            const result: Record<string, unknown> = {
              tag: node.tagName,
              id: node.id || undefined,
              class: node.className || undefined,
            };

            if (withText && node.childNodes.length === 1) {
              const firstChild = node.childNodes[0];
              if (firstChild && firstChild.nodeType === 3) {
                result.text = node.textContent?.trim();
              }
            }

            const children: Array<Record<string, unknown>> = [];
            const childElements = node.children;
            for (const child of Array.from(childElements)) {
              if (child) {
                const childTree = buildTree(child, currentDepth + 1);
                if (childTree) {
                  children.push(childTree);
                }
              }
            }

            if (children.length > 0) {
              result.children = children;
            }

            return result;
          }

          return buildTree(document.body, 0);
        },
        {depth: maxDepth, withText: includeText},
      );

      response.setStructuredContent({
        success: true,
        message: `DOM structure retrieved (depth: ${maxDepth}, include text: ${includeText})`,
        tooltype: 'get_dom_structure',
        data: structure ?? null,
      });
    } catch (error) {
      response.setStructuredContent({
        success: false,
        message: `Failed to get DOM structure: ${error instanceof Error ? error.message : String(error)}`,
        tooltype: 'get_dom_structure',
        data: null,
      });
    }
  },
});
