/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Locator, Page} from 'patchright';

import {withCdpSession} from '../browser/cdpUtils.js';
import {renderVom, type VomNode, type VomScene} from '../dom/vom/index.js';

import type {
  AXNode,
  SnapshotNode,
  SnapshotOptions,
  TextSnapshotResult,
} from './types.js';

interface AccessiblePage extends Page {
  accessibility?: {
    snapshot(options?: {interestingOnly?: boolean}): Promise<AXNode | null>;
  };
}

interface CdpAXValue {
  type?: string;
  value?: unknown;
}

interface CdpAXProperty {
  name: string;
  value?: CdpAXValue;
}

interface CdpAXNode {
  nodeId: string;
  ignored?: boolean;
  role?: CdpAXValue;
  name?: CdpAXValue;
  description?: CdpAXValue;
  value?: CdpAXValue;
  properties?: CdpAXProperty[];
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
}

const UNINTERESTING_ROLES = new Set([
  'none',
  'Ignored',
  'InlineTextBox',
  'LineBreak',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
  'SectionFooter',
  'SectionHeader',
]);

const STRUCTURAL_ROLES = new Set(['generic', 'GenericContainer', 'presentation']);

function extractCdpString(val?: CdpAXValue): string | undefined {
  if (val?.value === undefined || val.value === null) return undefined;
  const s = String(val.value);
  return s.length > 0 ? s : undefined;
}

function mapCdpProperties(raw: CdpAXNode): Partial<AXNode> {
  const out: Partial<AXNode> = {};
  if (!Array.isArray(raw.properties)) return out;

  for (const prop of raw.properties) {
    const v = prop.value?.value;
    if (v === undefined || v === null) continue;
    switch (prop.name) {
      case 'level':
        if (typeof v === 'number') out.level = v;
        break;
      case 'disabled':
        if (v === true) out.disabled = true;
        break;
      case 'expanded':
        if (typeof v === 'boolean') out.expanded = v;
        break;
      case 'focused':
        if (v === true) out.focused = true;
        break;
      case 'modal':
        if (v === true) out.modal = true;
        break;
      case 'multiline':
        if (v === true) out.multiline = true;
        break;
      case 'multiselectable':
        if (v === true) out.multiselectable = true;
        break;
      case 'readonly':
        if (v === true) out.readonly = true;
        break;
      case 'required':
        if (v === true) out.required = true;
        break;
      case 'selected':
        if (v === true) out.selected = true;
        break;
      case 'checked':
        if (v === 'mixed') out.checked = 'mixed';
        else if (v === 'true' || v === true) out.checked = true;
        else if (v === 'false' || v === false) out.checked = false;
        break;
      case 'pressed':
        if (v === 'mixed') out.pressed = 'mixed';
        else if (v === 'true' || v === true) out.pressed = true;
        else if (v === 'false' || v === false) out.pressed = false;
        break;
      case 'keyshortcuts':
        if (typeof v === 'string' && v) out.keyshortcuts = v;
        break;
      case 'roledescription':
        if (typeof v === 'string' && v) out.roledescription = v;
        break;
      case 'valuemin':
        if (typeof v === 'number') out.valuemin = v;
        break;
      case 'valuemax':
        if (typeof v === 'number') out.valuemax = v;
        break;
      case 'valuetext':
        if (typeof v === 'string' && v) out.valuetext = v;
        break;
    }
  }
  return out;
}

/**
 * 将 CDP `Accessibility.getFullAXTree` 返回的扁平节点数组转换为分层 AXNode 树。
 */
export function buildAxTreeFromCdpNodes(
  nodes: readonly CdpAXNode[],
  interestingOnly: boolean,
  maxDepth = 30,
): AXNode | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  const byId = new Map<string, CdpAXNode>();
  for (const node of nodes) {
    byId.set(node.nodeId, node);
  }

  const rootRaw = nodes.find(n => !n.parentId) ?? nodes[0];
  if (!rootRaw) return null;

  const visited = new Set<string>();

  const convert = (
    raw: CdpAXNode,
    depth: number,
    parentName?: string,
  ): AXNode[] => {
    if (visited.has(raw.nodeId) || depth > maxDepth) return [];
    visited.add(raw.nodeId);

    const role = extractCdpString(raw.role) ?? 'generic';
    const name = extractCdpString(raw.name);
    const valueRaw = raw.value?.value;
    const value =
      typeof valueRaw === 'string' || typeof valueRaw === 'number'
        ? valueRaw
        : undefined;
    const description = extractCdpString(raw.description);
    const props = mapCdpProperties(raw);

    const childNodes: AXNode[] = [];
    if (Array.isArray(raw.childIds) && depth < maxDepth) {
      for (const childId of raw.childIds) {
        const childRaw = byId.get(childId);
        if (childRaw) {
          childNodes.push(...convert(childRaw, depth + 1, name ?? parentName));
        }
      }
    }

    const isRoot = raw === rootRaw;
    if (interestingOnly && !isRoot) {
      if (raw.ignored || UNINTERESTING_ROLES.has(role)) {
        return childNodes;
      }
      // StaticText 若仅重复父控件（如 button/link/heading）的 accessible name，折叠掉减少噪声
      if (role === 'StaticText' && name && parentName && name === parentName) {
        return childNodes;
      }
      const hasSemanticProps =
        name !== undefined ||
        value !== undefined ||
        description !== undefined ||
        Object.keys(props).length > 0;
      if (STRUCTURAL_ROLES.has(role) && !hasSemanticProps) {
        return childNodes;
      }
    }

    const axNode: AXNode = {
      role,
      ...(name !== undefined ? {name} : {}),
      ...(value !== undefined ? {value} : {}),
      ...(description !== undefined ? {description} : {}),
      ...props,
      ...(childNodes.length > 0 ? {children: childNodes} : {}),
    };
    return [axNode];
  };

  const built = convert(rootRaw, 0);
  return built[0] ?? null;
}

export type SnapshotMode = 'ax' | 'vom';

export interface ExtendedSnapshotOptions extends SnapshotOptions {
  mode?: SnapshotMode;
}

export interface InPageVomRawNode {
  id: number;
  parentId: number | null;
  tag: string;
  role?: string;
  name?: string;
  value?: string;
  text?: string;
  placeholder?: string;
  rect: {x: number; y: number; w: number; h: number} | null;
  paintOrder: number;
  position: string;
  pointerEvents: string;
  clickable: boolean;
  modal?: boolean;
  disabled?: boolean;
  focused?: boolean;
  referenceable?: boolean;
  selector?: string;
}

export class PageSnapshotManager {
  private nextSnapshotId = 1;
  private readonly pageSnapshots = new WeakMap<object, TextSnapshotResult>();
  private readonly nodeLocators = new WeakMap<
    object,
    Map<
      string,
      {selector?: string; role?: string; name?: string; x?: number; y?: number}
    >
  >();

  /**
   * 采集页面语义快照，支持无障碍树（ax）与视口遮挡剪枝（vom）模式。
   */
  async capture(
    page: Page,
    options: ExtendedSnapshotOptions = {},
  ): Promise<TextSnapshotResult> {
    const mode = options.mode ?? 'ax';
    if (mode === 'vom') {
      return this.captureVom(page, options);
    }
    return this.captureAx(page, options);
  }

  private async captureAxViaCdp(
    page: Page,
    interestingOnly: boolean,
    maxDepth: number,
  ): Promise<AXNode | null> {
    if (typeof page.context !== 'function') {
      return null;
    }
    const ctx = page.context();
    if (!ctx || typeof ctx.newCDPSession !== 'function') {
      return null;
    }
    return await withCdpSession(page, async client => {
      const res = (await client.send('Accessibility.getFullAXTree')) as {
        nodes?: CdpAXNode[];
      };
      return buildAxTreeFromCdpNodes(
        res?.nodes ?? [],
        interestingOnly,
        maxDepth,
      );
    });
  }

  private async captureAx(
    page: Page,
    options: SnapshotOptions = {},
  ): Promise<TextSnapshotResult> {
    const interestingOnly = options.interestingOnly ?? !options.verbose;
    const maxDepth = options.maxDepth ?? 30;
    const accessiblePage = page as AccessiblePage;
    let axRoot: AXNode | null = null;
    if (typeof accessiblePage.accessibility?.snapshot === 'function') {
      axRoot = (await accessiblePage.accessibility.snapshot({
        interestingOnly,
      })) as AXNode | null;
    } else {
      axRoot = await this.captureAxViaCdp(page, interestingOnly, maxDepth);
    }

    const snapshotId = String(this.nextSnapshotId++);
    const idToNode = new Map<string, SnapshotNode>();
    let idCounter = 0;

    const effectiveRoot: AXNode = axRoot ?? {
      role: 'WebArea',
      name: 'Empty Document',
      children: [],
    };

    const assignIds = (node: AXNode, currentDepth: number): SnapshotNode => {
      const uid = `${snapshotId}_${idCounter++}`;
      const children: SnapshotNode[] = [];

      const {children: _rawChildren, ...rest} = node;
      const snapshotNode: SnapshotNode = {
        ...rest,
        id: uid,
      };

      idToNode.set(uid, snapshotNode);

      if (node.children && currentDepth < maxDepth) {
        for (const child of node.children) {
          children.push(assignIds(child, currentDepth + 1));
        }
      }

      snapshotNode.children = children;
      return snapshotNode;
    };

    const root = assignIds(effectiveRoot, 0);
    const formattedText = this.formatTree(root, options.verbose ?? false);

    const result: TextSnapshotResult = {
      snapshotId,
      root,
      idToNode,
      formattedText,
      nodeCount: idToNode.size,
    };

    if (page && typeof page === 'object') {
      this.pageSnapshots.set(page, result);
    }

    return result;
  }

  private async captureVom(
    page: Page,
    options: SnapshotOptions = {},
  ): Promise<TextSnapshotResult> {
    const snapshotId = String(this.nextSnapshotId++);

    const evaluated = await page.evaluate(
      (): {
        viewport: {width: number; height: number};
        nodes: InPageVomRawNode[];
      } => {
        const vw =
          window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh =
          window.innerHeight || document.documentElement.clientHeight || 720;

        const elements = Array.from(document.querySelectorAll('*'));
        let idGen = 1;
        const elToId = new Map<Element, number>();

        const rawNodes: InPageVomRawNode[] = [];

        for (const el of elements) {
          const id = idGen++;
          elToId.set(el, id);
        }

        for (const el of elements) {
          const id = elToId.get(el)!;
          const parentId = el.parentElement
            ? (elToId.get(el.parentElement) ?? null)
            : null;
          const tag = el.tagName.toLowerCase();
          const style = window.getComputedStyle(el);

          if (style.display === 'none' || style.visibility === 'hidden') {
            continue;
          }

          const bcr = el.getBoundingClientRect();
          const rect = {
            x: Math.round(bcr.left),
            y: Math.round(bcr.top),
            w: Math.round(bcr.width),
            h: Math.round(bcr.height),
          };

          const role = el.getAttribute('role') || undefined;
          const name =
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.getAttribute('placeholder') ||
            (el instanceof HTMLInputElement || el instanceof HTMLButtonElement
              ? el.value
              : undefined) ||
            undefined;

          const isInput =
            tag === 'input' || tag === 'textarea' || tag === 'select';
          const isButton =
            tag === 'button' ||
            role === 'button' ||
            (tag === 'input' &&
              (el.getAttribute('type') === 'button' ||
                el.getAttribute('type') === 'submit'));
          const isLink = tag === 'a' && el.hasAttribute('href');
          const isClickable =
            isButton ||
            isLink ||
            isInput ||
            style.cursor === 'pointer' ||
            el.hasAttribute('onclick');

          const isModal =
            tag === 'dialog' ||
            role === 'dialog' ||
            role === 'alertdialog' ||
            el.getAttribute('aria-modal') === 'true';

          // 生成相对唯一的 CSS 选择器或辅助定位信息
          let selector: string | undefined;
          if (el.id) {
            selector = `#${CSS.escape(el.id)}`;
          } else if (name) {
            selector = `[aria-label="${CSS.escape(name)}"]`;
          }

          const node: InPageVomRawNode = {
            id,
            parentId,
            tag,
            role: role ?? (isButton ? 'button' : isLink ? 'link' : undefined),
            name:
              name ??
              (el.childElementCount === 0
                ? el.textContent?.trim().slice(0, 80)
                : undefined),
            value:
              isInput && el instanceof HTMLInputElement ? el.value : undefined,
            text:
              el.childElementCount === 0 ? el.textContent?.trim() : undefined,
            rect: rect.w > 0 && rect.h > 0 ? rect : null,
            paintOrder: id,
            position: style.position || 'static',
            pointerEvents: style.pointerEvents || 'auto',
            clickable: isClickable,
            modal: isModal,
            disabled:
              el.hasAttribute('disabled') ||
              el.getAttribute('aria-disabled') === 'true',
            focused: document.activeElement === el,
            referenceable: isClickable || isInput,
            selector,
          };

          rawNodes.push(node);
        }

        return {
          viewport: {width: vw, height: vh},
          nodes: rawNodes,
        };
      },
    );

    const vomNodes: VomNode[] = evaluated.nodes.map(n => ({
      ...n,
      rect: n.rect,
      attrs: {},
    }));

    const scene: VomScene = {
      viewport: evaluated.viewport,
      nodes: vomNodes,
    };

    const vomResult = renderVom(scene, {
      maxDepth: options.maxDepth,
    });

    const idToNode = new Map<string, SnapshotNode>();
    const locatorMap = new Map<
      string,
      {selector?: string; role?: string; name?: string; x?: number; y?: number}
    >();

    // 构建符合 SnapshotNode 协议的节点树以兼容现有定位体系
    const rootNode: SnapshotNode = {
      id: `${snapshotId}_0`,
      role: 'WebArea',
      name: 'VOM Scene',
      children: [],
    };
    idToNode.set(rootNode.id, rootNode);

    let uidCounter = 1;
    for (const renderedRef of vomResult.refs) {
      const rawNode = evaluated.nodes.find(
        n => n.id === renderedRef.backendNodeId,
      );
      const uid = `${snapshotId}_${uidCounter++}`;
      const snapNode: SnapshotNode = {
        id: uid,
        role: rawNode?.role ?? renderedRef.role,
        name: rawNode?.name ?? renderedRef.name,
        value: rawNode?.value,
        description: rawNode?.text,
        disabled: rawNode?.disabled,
        focused: rawNode?.focused,
      };
      idToNode.set(uid, snapNode);
      rootNode.children!.push(snapNode);

      locatorMap.set(uid, {
        selector: rawNode?.selector,
        role: snapNode.role,
        name: snapNode.name,
        x: rawNode?.rect?.x,
        y: rawNode?.rect?.y,
      });
    }

    const result: TextSnapshotResult = {
      snapshotId,
      root: rootNode,
      idToNode,
      formattedText: vomResult.text,
      nodeCount: idToNode.size,
    };

    if (page && typeof page === 'object') {
      this.pageSnapshots.set(page, result);
      this.nodeLocators.set(page, locatorMap);
    }

    return result;
  }

  /**
   * 获取指定页面缓存的快照。
   */
  getSnapshot(page: Page): TextSnapshotResult | undefined {
    if (!page || typeof page !== 'object') return undefined;
    return this.pageSnapshots.get(page);
  }

  /**
   * 根据 UID 从快照映射并生成 Playwright/Patchright 定位器。
   */
  getLocatorByUid(page: Page, uid: string): Locator {
    const snapshot = this.getSnapshot(page);
    if (!snapshot) {
      throw new Error(
        `No snapshot found for the page. Please run take_snapshot first to capture page elements.`,
      );
    }

    const node = snapshot.idToNode.get(uid);
    if (!node) {
      throw new Error(
        `Element uid "${uid}" not found in page snapshot. The page content may have changed. Please run take_snapshot to refresh.`,
      );
    }

    const locators = this.nodeLocators.get(page);
    const locMeta = locators?.get(uid);
    if (locMeta?.selector) {
      return page.locator(locMeta.selector);
    }

    return this.resolveLocator(page, node);
  }

  /**
   * 清除指定页面或全部快照缓存。
   */
  clear(page?: Page): void {
    if (page && typeof page === 'object') {
      this.pageSnapshots.delete(page);
      this.nodeLocators.delete(page);
    }
  }

  private resolveLocator(page: Page, node: SnapshotNode): Locator {
    const role = this.normalizeRole(node.role);
    const name = node.name ? String(node.name).trim() : undefined;

    if (role && name) {
      return page.getByRole(role, {name, exact: false});
    }

    if (role) {
      return page.getByRole(role);
    }

    if (name) {
      return page.getByText(name, {exact: false});
    }

    return page.locator(`[aria-label="${name ?? ''}"]`);
  }

  private normalizeRole(
    role?: string,
  ): Parameters<Page['getByRole']>[0] | undefined {
    if (!role) return undefined;
    const lower = role.toLowerCase() as Parameters<Page['getByRole']>[0];
    const validRoles = new Set<string>([
      'alert',
      'alertdialog',
      'application',
      'article',
      'banner',
      'blockquote',
      'button',
      'caption',
      'cell',
      'checkbox',
      'code',
      'columnheader',
      'combobox',
      'complementary',
      'contentinfo',
      'definition',
      'deletion',
      'dialog',
      'directory',
      'document',
      'emphasis',
      'feed',
      'figure',
      'form',
      'generic',
      'grid',
      'gridcell',
      'group',
      'heading',
      'img',
      'insertion',
      'link',
      'list',
      'listbox',
      'listitem',
      'log',
      'main',
      'marquee',
      'math',
      'menu',
      'menubar',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'meter',
      'navigation',
      'none',
      'note',
      'option',
      'paragraph',
      'progressbar',
      'radio',
      'radiogroup',
      'region',
      'row',
      'rowgroup',
      'rowheader',
      'scrollbar',
      'search',
      'searchbox',
      'separator',
      'slider',
      'spinbutton',
      'status',
      'strong',
      'subscript',
      'superscript',
      'switch',
      'tab',
      'table',
      'tablist',
      'tabpanel',
      'term',
      'textbox',
      'time',
      'timer',
      'toolbar',
      'tooltip',
      'tree',
      'treegrid',
      'treeitem',
    ]);

    return validRoles.has(lower) ? lower : undefined;
  }

  private formatTree(node: SnapshotNode, verbose: boolean, depth = 0): string {
    const lines: string[] = [];
    const indent = '  '.repeat(depth);

    const parts: string[] = [`uid=${node.id}`];
    if (node.role) {
      parts.push(node.role);
    }
    if (node.name) {
      parts.push(`"${node.name.replace(/\n+/g, ' ')}"`);
    }
    if (node.value !== undefined) {
      parts.push(`value="${String(node.value)}"`);
    }
    if (node.level !== undefined) {
      parts.push(`(level=${node.level})`);
    }
    if (node.focused) {
      parts.push('(focused)');
    }
    if (node.disabled) {
      parts.push('(disabled)');
    }
    if (node.checked !== undefined) {
      parts.push(`(checked=${String(node.checked)})`);
    }
    if (verbose && node.description) {
      parts.push(`description="${node.description}"`);
    }

    lines.push(`${indent}${parts.join(' ')}`);

    if (node.children) {
      for (const child of node.children) {
        lines.push(this.formatTree(child, verbose, depth + 1));
      }
    }

    return lines.join('\n');
  }
}

export const globalPageSnapshotManager = new PageSnapshotManager();
