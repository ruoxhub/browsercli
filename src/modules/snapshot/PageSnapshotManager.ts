/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Locator, Page} from 'patchright';

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

type AriaRole = Parameters<Page['getByRole']>[0];

export class PageSnapshotManager {
  private nextSnapshotId = 1;
  private readonly pageSnapshots = new WeakMap<object, TextSnapshotResult>();

  /**
   * 采集页面无障碍树（AXTree），分配数字 UID 并格式化为紧凑语义大纲。
   */
  async capture(
    page: Page,
    options: SnapshotOptions = {},
  ): Promise<TextSnapshotResult> {
    const interestingOnly = options.interestingOnly ?? !options.verbose;
    const accessiblePage = page as AccessiblePage;
    const axRoot = (await accessiblePage.accessibility?.snapshot({
      interestingOnly,
    })) as AXNode | null;

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

      const maxDepth = options.maxDepth ?? 30;
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

    return this.resolveLocator(page, node);
  }

  /**
   * 清除指定页面或全部快照缓存。
   */
  clear(page?: Page): void {
    if (page && typeof page === 'object') {
      this.pageSnapshots.delete(page);
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

  private normalizeRole(role?: string): AriaRole | undefined {
    if (!role) return undefined;
    const lower = role.toLowerCase() as AriaRole;
    // Playwright 支持的标准 ARIA 角色
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
      'meter',
      'menu',
      'menubar',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'navigation',
      'none',
      'note',
      'option',
      'paragraph',
      'presentation',
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

    if (validRoles.has(lower)) {
      return lower;
    }
    return undefined;
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
