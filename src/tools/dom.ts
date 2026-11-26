/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../modules/browser/cdpUtils.js';
import {
  readSnapshot,
  type SnapshotNode,
} from '../modules/dom/SnapshotReader.js';
import {globalPageSnapshotManager} from '../modules/snapshot/PageSnapshotManager.js';
import {type Frame, zod} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';
import {logger} from '../utils/logger.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {NO_ACTIVE_PAGE_MESSAGE} from './shared/activePageResolver.js';
import {toElementError} from './shared/elementLocator.js';
import {type Context, definePageTool} from './ToolDefinition.js';

// ─── types.ts ────────────────────────────────────────────

/** 元素信息（对应 DOMInspector.ElementInfo） */
export interface ElementInfo {
  found: boolean;
  nodeId?: number;
  nodeName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible?: boolean;
}

/** 可点击元素信息（对应 DOMInspector.ClickableElement） */
export interface ClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input' | 'other';
  visible: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** queryDom 参数 */
export interface QueryDomParams {
  /** 元素定位器（CSS / role= / text= / xpath=） */
  selector: string;
  /** 是否查询所有匹配元素（默认 false，仅查询第一个） */
  all?: boolean;
  /** 查询所有时的最大返回数量（默认 50） */
  limit?: number;
}

/** queryDom 结果 */
export interface QueryDomResult {
  tooltype: 'query_dom';
  success: boolean;
  message: string;
  data?: ElementInfo | ElementInfo[] | null;
}

/** getDomStructure 参数 */
export interface GetDomStructureParams {
  /** DOM 树最大深度（默认 3） */
  maxDepth?: number;
  /** 是否包含文本内容（默认 true） */
  includeText?: boolean;
}

/** getDomStructure 结果 */
export interface GetDomStructureResult {
  tooltype: 'get_dom_structure';
  success: boolean;
  message: string;
  data?: Record<string, unknown> | null;
}

/** findClickableElements 参数 */
export interface FindClickableElementsParams {
  /** 按文本内容过滤（可选） */
  filterText?: string;
}

/** findClickableElements 结果 */
export interface FindClickableElementsResult {
  tooltype: 'find_clickable_elements';
  success: boolean;
  message: string;
  data?: ClickableElement[];
}

export type {Frame};

// ─── findClickableElements.ts ────────────────────────────

/**
 * 查找页面中可点击的按钮和链接。
 *
 * 优先走 CDP 快照（穿透 shadow DOM、识别 JS 绑定的点击）；快照不可用时回退到
 * 当前 Frame 内的 JS 查询。支持按文本内容过滤。
 */
export const findClickableElements = definePageTool({
  name: 'find_clickable_elements',
  description:
    '查找当前页面中可点击的按钮与链接，可按文本内容过滤，返回选择器、文本、类型、可见性与包围盒。',
  annotations: {
    title: '查找可点击元素',
    category: ToolCategory.DOM,
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

// ─── getDomStructure.ts ──────────────────────────────────

/**
 * 获取页面 DOM 树结构。
 *
 * 在当前 Frame 中注入遍历代码，返回指定深度的 DOM 树结构。
 * 可选包含文本内容，便于 AI 理解页面布局。
 */
export const getDomStructure = definePageTool({
  name: 'get_dom_structure',
  description:
    '获取当前页面的 DOM 树结构，返回包含标签名、ID、类名及可选文本内容的层级树。',
  annotations: {
    title: '获取DOM结构',
    category: ToolCategory.DOM,
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
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'get_dom_structure',
      });
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
      throw createToolError(
        ErrorCodes.RUNTIME,
        `Failed to get DOM structure: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'get_dom_structure'},
      );
    }
  },
});

// ─── queryDom.ts ─────────────────────────────────────────

/**
 * 通过定位器查询 DOM 元素。
 *
 * 在当前 Frame 中注入查询代码，返回匹配元素的结构化信息。
 * 默认查询第一个匹配元素（querySelector），设置 all=true 时查询所有匹配元素。
 */
export const queryDom = definePageTool({
  name: 'query_dom',
  description:
    '通过定位器查询一个或多个 DOM 元素，返回包含标签、属性、包围盒与可见性的结构化信息。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。',
  annotations: {
    title: '查询DOM元素',
    category: ToolCategory.DOM,
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

// ─── revealInDevtools.ts ─────────────────────────────────

const PROBE_ATTR = 'data-pcli-css-probe';

/**
 * 在页面上高亮目标元素（DevTools Elements 面板式的视觉定位）。
 *
 * 原生实现：probe 属性桥接 → Overlay.highlightNode → 延时 hideHighlight。
 * DevTools 面板导航（reveal-in-panel）需要前端 UI 命令通道，同样未实现。
 */
export const revealInDevtools = definePageTool({
  name: 'reveal_in_devtools',
  description:
    '在页面上高亮指定元素（相当于 DevTools Elements 面板的节点高亮），持续指定时间后自动消失。用于逆向分析时快速定位目标 DOM。',
  annotations: {
    title: '高亮元素',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .describe('目标元素的定位器（支持 CSS、role=、text=、xpath=）。'),
    durationMs: zod
      .number()
      .int()
      .min(200)
      .max(30000)
      .optional()
      .describe('高亮持续时间（毫秒），默认 3000。'),
  },
  handler: async (request, response, context) => {
    const {selector, durationMs = 3000} = request.params;
    const frame = (context as Context).getSelectedFrame();
    if (!frame) {
      throw createToolError(ErrorCodes.FRAME_REQUIRED, NO_ACTIVE_PAGE_MESSAGE, {
        toolName: 'reveal_in_devtools',
      });
    }
    const page = frame.page();
    // 探针属性 + DOM.querySelector 基于 page 级顶层文档，子 frame 内的元素
    // 无法桥接；显式报错好过最后以「CDP 查询失败」误导调用方。
    // 仅当上下文确实暴露 parentFrame() 时才判定（测试替身可能没有）。
    const parentFrame = (
      frame as unknown as {parentFrame?: () => unknown}
    ).parentFrame?.();
    if (parentFrame) {
      throw createToolError(
        ErrorCodes.FRAME_REQUIRED,
        'reveal_in_devtools 仅支持主 frame 中的元素，请先用 select_frame 切回主 frame（index 0）。',
        {toolName: 'reveal_in_devtools', selector},
      );
    }

    const probe = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    try {
      const element = frame.locator(selector).first();
      await element.evaluate(
        (node, [attr, value]) => {
          node.setAttribute(attr, value);
        },
        [PROBE_ATTR, probe],
      );

      await withCdpSession(page, async client => {
        await client.send('DOM.enable');
        await client.send('Overlay.enable');
        const {root} = (await client.send('DOM.getDocument', {
          depth: 0,
        })) as {root: {nodeId: number}};
        const {nodeId} = (await client.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: `[${PROBE_ATTR}="${probe}"]`,
        })) as {nodeId: number};
        if (!nodeId) {
          throw createToolError(
            ErrorCodes.VALIDATION,
            `元素定位成功但 CDP 查询失败：${selector}`,
            {toolName: 'reveal_in_devtools', selector},
          );
        }
        await client.send('Overlay.highlightNode', {
          nodeId,
          highlightConfig: {
            showInfo: true,
            showStyles: true,
            contentColor: {r: 111, g: 168, b: 220, a: 1},
          },
        });
        // Overlay highlight 状态随 CDP session 存亡，必须在同一 session 内
        // 等待后主动 hide，否则 session detach 会让高亮立即消失。
        await new Promise(resolve => setTimeout(resolve, durationMs));
        await client.send('Overlay.hideHighlight');
      });

      response.setStructuredContent({
        success: true,
        message: `Element ${selector} highlighted for ${durationMs}ms.`,
        tooltype: 'reveal_in_devtools',
        data: {selector, durationMs},
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'reveal_in_devtools', selector});
    } finally {
      try {
        await frame
          .locator(selector)
          .first()
          .evaluate((node, attr) => {
            node.removeAttribute(attr);
          }, PROBE_ATTR);
      } catch {
        // 元素可能已被移除
      }
    }
  },
});

// ─── takeSnapshot.ts ─────────────────────────────────────

export const takeSnapshot = definePageTool({
  name: 'take_snapshot',
  description:
    '获取当前页面的紧凑无障碍语义快照（TextSnapshot）。为每个交互控件分配数字 UID（如 1_4），可直接用于 click、fill、hover 等操作，支持保存到文件以节省上下文。',
  annotations: {
    title: '获取页面语义快照',
    category: ToolCategory.DOM,
    readOnlyHint: true,
    requirements: {
      browser: 'connected',
      page: 'selected',
    },
  },
  blockedByDialog: true,
  concurrency: 'page',
  schema: {
    mode: zod
      .enum(['ax', 'vom'])
      .optional()
      .describe(
        '快照模式：ax 为标准无障碍树（默认），vom 为视口遮挡剪枝（剔除遮挡背景，聚焦可见交互层）。',
      ),
    verbose: zod
      .boolean()
      .optional()
      .describe('是否输出详细节点属性（如 description 等），默认 false。'),
    interestingOnly: zod
      .boolean()
      .optional()
      .describe('是否仅包含有可访问性或交互价值的节点，默认 true。'),
    filePath: zod
      .string()
      .optional()
      .describe(
        '可选：将快照文本保存到指定文件路径，而非全部内联输出到响应中。',
      ),
  },
  handler: async (request, response, context) => {
    const {
      mode = 'ax',
      verbose = false,
      interestingOnly = true,
      filePath,
    } = request.params;
    const ctx = context as Context;
    const page = ctx.getSelectedPage();

    if (!page) {
      throw createToolError(
        ErrorCodes.PAGE_REQUIRED,
        '当前没有活动的页面，请先调用 new_page 或 select_page。',
        {toolName: 'take_snapshot'},
      );
    }

    try {
      const snapshot = await globalPageSnapshotManager.capture(page, {
        mode,
        verbose,
        interestingOnly,
      });

      if (filePath) {
        const data = new TextEncoder().encode(snapshot.formattedText);
        const {filename} = await ctx.saveFile(data, filePath);
        response.appendResponseLine(
          `页面快照捕获成功（快照 ID: ${snapshot.snapshotId}，共 ${snapshot.nodeCount} 个节点），已保存到: ${filename}`,
        );
        response.setStructuredContent({
          success: true,
          snapshotId: snapshot.snapshotId,
          nodeCount: snapshot.nodeCount,
          savedPath: filename,
        });
        return;
      }

      response.appendResponseLine(
        `页面快照捕获成功（快照 ID: ${snapshot.snapshotId}，共 ${snapshot.nodeCount} 个节点）：`,
      );
      response.appendResponseLine(snapshot.formattedText);

      response.setStructuredContent({
        success: true,
        snapshotId: snapshot.snapshotId,
        nodeCount: snapshot.nodeCount,
        textOutline: snapshot.formattedText,
      });
    } catch (error) {
      throw createToolError(
        ErrorCodes.RUNTIME,
        `获取页面语义快照失败: ${error instanceof Error ? error.message : String(error)}`,
        {toolName: 'take_snapshot'},
      );
    }
  },
});

// ─── Re-exports ────────────────────────────────────────────

export {
  getNetworkMultiplierFromString,
  PREDEFINED_NETWORK_MULTIPLIERS,
  WaitForHelper,
  type DialogAction,
  type WaitForEventsOptions,
  type WaitForEventsResult,
} from '../modules/browser/WaitForHelper.js';

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'dom',
  description: 'DOM inspection and querying tools.',
  profile: 'workflow',
  tools: [
    {modulePath: './dom.js', handlerName: 'queryDom'},
    {modulePath: './dom.js', handlerName: 'getDomStructure'},
    {
      modulePath: './dom.js',
      handlerName: 'findClickableElements',
    },
    {
      modulePath: './dom.js',
      handlerName: 'takeSnapshot',
    },
    {
      modulePath: './dom.js',
      handlerName: 'revealInDevtools',
      profile: 'full',
    },
  ],
} satisfies DomainManifest;
