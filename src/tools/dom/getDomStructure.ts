/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';

import type {GetDomStructureParams, GetDomStructureResult} from './types.js';

/**
 * 获取页面 DOM 树结构。
 *
 * 在 Playwright Frame 中注入遍历代码，返回指定深度的 DOM 树结构。
 * 可选包含文本内容，便于 AI 理解页面布局。
 *
 * @param frame - Playwright Frame 对象，用于注入遍历代码
 * @param params - 结构参数
 * @returns 结构化结果对象
 */
export async function getDomStructure(
  frame: Frame,
  params: GetDomStructureParams = {},
): Promise<GetDomStructureResult> {
  const {maxDepth = 3, includeText = true} = params;
  const tooltype = 'get_dom_structure';

  try {
    const structure = await frame.evaluate(
      ({depth, withText}) => {
        function buildTree(node: Element, currentDepth: number): Record<
          string,
          unknown
        > | null {
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

    return {
      success: true,
      message: `DOM 结构已获取（深度：${maxDepth}，文本：${includeText ? '是' : '否'}）`,
      tooltype,
      logFormat: 'full',
      data: structure ?? undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: `获取 DOM 结构失败：${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}
