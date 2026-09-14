/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * DOM 快照读取层：单次 DOMSnapshot.captureSnapshot → 扁平 SnapshotNode[]。
 *
 * 数据源为 CDP 原生快照，天然穿透 shadow DOM，不注入任何 JS。
 * 解析逻辑为纯函数，可在无浏览器环境下单测。
 */

import type {Page} from '../../third_party/index.js';
import {withCdpSession} from '../browser/cdpUtils.js';

export interface SnapshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotNode {
  backendNodeId: number;
  tagName: string;
  attributes: Record<string, string>;
  text: string;
  isVisible: boolean;
  isInteractive: boolean;
  bounds?: SnapshotBounds;
  cursor?: string;
  paintOrder?: number;
  shadowRootType?: string;
  computedStyles: Record<string, string>;
  inIframe: boolean;
  ignoredByPaintOrder: boolean;
}

/** 仅请求判定交互性与可见性所需的计算样式，避免重站点上快照体积膨胀。 */
export const REQUIRED_COMPUTED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'cursor',
  'pointer-events',
  'position',
  'background-color',
] as const;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const INTERACTIVE_TAGS = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'details',
  'summary',
  'option',
  'optgroup',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'option',
  'radio',
  'checkbox',
  'tab',
  'textbox',
  'combobox',
  'slider',
  'spinbutton',
  'search',
  'searchbox',
  'row',
  'cell',
  'gridcell',
  'listbox',
  'switch',
]);

const EVENT_ATTRIBUTES = [
  'onclick',
  'onmousedown',
  'onmouseup',
  'onkeydown',
  'onkeyup',
  'ontouchstart',
] as const;

const SENSITIVE_INPUT_TYPES = new Set(['password', 'file', 'hidden']);
const SENSITIVE_AUTOCOMPLETE_PREFIXES = ['cc-', 'one-time-code'];

function isSensitiveField(attributes: Record<string, string>): boolean {
  const type = (attributes.type ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  const autocomplete = (attributes.autocomplete ?? '').toLowerCase();
  return SENSITIVE_AUTOCOMPLETE_PREFIXES.some(prefix =>
    autocomplete.startsWith(prefix),
  );
}

function isFileInput(
  tagName: string,
  attributes: Record<string, string>,
): boolean {
  return (
    tagName === 'input' && (attributes.type ?? '').toLowerCase() === 'file'
  );
}

function computeInteractivity(
  tagName: string,
  attributes: Record<string, string>,
  computedStyles: Record<string, string>,
  fromSnapshot: boolean,
): boolean {
  if (fromSnapshot) return true;
  if (computedStyles.cursor === 'pointer') return true;
  if (INTERACTIVE_TAGS.has(tagName)) return true;
  if (EVENT_ATTRIBUTES.some(name => attributes[name] !== undefined))
    return true;
  const role = (attributes.role ?? '').toLowerCase();
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (attributes.tabindex !== undefined) return true;
  return false;
}

interface RareData<T> {
  index?: number[];
  value?: T[];
}

interface RawNodeTree {
  parentIndex?: number[];
  nodeType?: number[];
  nodeName?: number[];
  nodeValue?: number[];
  backendNodeId?: number[];
  attributes?: number[][];
  isClickable?: RareData<boolean>;
  textValue?: RareData<number>;
  inputValue?: RareData<number>;
  shadowRootType?: RareData<number>;
}

interface RawLayoutTree {
  nodeIndex?: number[];
  bounds?: number[][];
  styles?: number[][];
  paintOrders?: number[];
}

interface RawDocument {
  nodes?: RawNodeTree;
  layout?: RawLayoutTree;
}

export interface RawSnapshot {
  strings?: string[];
  documents?: RawDocument[];
}

function str(index: number | undefined, strings: string[]): string {
  if (typeof index !== 'number' || index < 0 || index >= strings.length) {
    return '';
  }
  return strings[index];
}

function rareStringMap(
  data: RareData<number> | undefined,
  strings: string[],
): Map<number, string> {
  const map = new Map<number, string>();
  const indexes = data?.index ?? [];
  const values = data?.value ?? [];
  indexes.forEach((nodeIndex, position) => {
    const value = str(values[position], strings);
    if (value) map.set(nodeIndex, value);
  });
  return map;
}

function readAttributes(
  flat: number[] | undefined,
  strings: string[],
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!flat) return attributes;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const name = str(flat[i], strings);
    if (name) attributes[name] = str(flat[i + 1], strings);
  }
  return attributes;
}

function readBounds(
  bounds: number[] | undefined,
  devicePixelRatio: number,
): SnapshotBounds | undefined {
  if (!bounds || bounds.length < 4) return undefined;
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    x: bounds[0] / ratio,
    y: bounds[1] / ratio,
    width: bounds[2] / ratio,
    height: bounds[3] / ratio,
  };
}

function readStyles(
  styleIndexes: number[] | undefined,
  strings: string[],
): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleIndexes) return styles;
  REQUIRED_COMPUTED_STYLES.forEach((name, position) => {
    const value = str(styleIndexes[position], strings);
    if (value) styles[name] = value;
  });
  return styles;
}

function computeVisibility(
  tagName: string,
  attributes: Record<string, string>,
  computedStyles: Record<string, string>,
  bounds: SnapshotBounds | undefined,
): boolean {
  if (isFileInput(tagName, attributes)) return true;
  if (computedStyles.display === 'none') return false;
  if (computedStyles.visibility === 'hidden') return false;
  if (computedStyles.opacity === '0') return false;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  return true;
}

export function parseSnapshot(
  raw: RawSnapshot,
  devicePixelRatio = 1,
): SnapshotNode[] {
  const strings = raw.strings ?? [];
  const result: SnapshotNode[] = [];

  (raw.documents ?? []).forEach((document, documentIndex) => {
    const nodes = document.nodes ?? {};
    const layout = document.layout ?? {};
    const nodeTypes = nodes.nodeType ?? [];
    const nodeNames = nodes.nodeName ?? [];
    const nodeValues = nodes.nodeValue ?? [];
    const backendIds = nodes.backendNodeId ?? [];
    const attributeLists = nodes.attributes ?? [];
    const parentIndexes = nodes.parentIndex ?? [];
    const clickableIndexes = new Set<number>(nodes.isClickable?.index ?? []);
    const textValueByIndex = rareStringMap(nodes.textValue, strings);
    const inputValueByIndex = rareStringMap(nodes.inputValue, strings);
    const shadowTypeByIndex = rareStringMap(nodes.shadowRootType, strings);

    // nodeIndex → layoutIndex，首次出现优先；预建映射避免 O(n²) 回查。
    const layoutIndexByNode = new Map<number, number>();
    (layout.nodeIndex ?? []).forEach((nodeIndex, layoutIndex) => {
      if (!layoutIndexByNode.has(nodeIndex)) {
        layoutIndexByNode.set(nodeIndex, layoutIndex);
      }
    });

    const childrenByParent = new Map<number, number[]>();
    parentIndexes.forEach((parent, index) => {
      if (typeof parent !== 'number' || parent < 0) return;
      const children = childrenByParent.get(parent);
      if (children) children.push(index);
      else childrenByParent.set(parent, [index]);
    });

    // ponytail: 递归聚合文本按节点记忆化，单页 O(总文本量)；若实测超时，改为只对交互元素按需聚合。
    const textCache = new Map<number, string>();
    const collectText = (index: number): string => {
      const cached = textCache.get(index);
      if (cached !== undefined) return cached;
      let value = '';
      if (nodeTypes[index] === TEXT_NODE) {
        value = str(nodeValues[index], strings).trim();
      } else {
        for (const child of childrenByParent.get(index) ?? []) {
          value += collectText(child);
        }
      }
      const normalized = value.trim();
      textCache.set(index, normalized);
      return normalized;
    };

    for (let index = 0; index < backendIds.length; index += 1) {
      const backendNodeId = backendIds[index];
      if (typeof backendNodeId !== 'number') continue;

      const nodeType = nodeTypes[index] ?? 0;
      const tagName = str(nodeNames[index], strings).toLowerCase();
      const attributes = readAttributes(attributeLists[index], strings);
      const layoutIndex = layoutIndexByNode.get(index);
      const bounds = readBounds(
        layoutIndex === undefined ? undefined : layout.bounds?.[layoutIndex],
        devicePixelRatio,
      );
      const computedStyles = readStyles(
        layoutIndex === undefined ? undefined : layout.styles?.[layoutIndex],
        strings,
      );
      const paintOrder =
        layoutIndex === undefined
          ? undefined
          : layout.paintOrders?.[layoutIndex];
      const sensitive = isSensitiveField(attributes);
      if (sensitive) {
        delete attributes.value;
        delete attributes.valuetext;
      }
      const liveValue = sensitive
        ? ''
        : (textValueByIndex.get(index) ?? inputValueByIndex.get(index) ?? '');
      const text =
        nodeType === TEXT_NODE
          ? str(nodeValues[index], strings).trim()
          : liveValue || (sensitive ? '' : collectText(index));

      result.push({
        backendNodeId,
        tagName,
        attributes,
        text,
        isVisible:
          nodeType === ELEMENT_NODE &&
          computeVisibility(tagName, attributes, computedStyles, bounds),
        isInteractive:
          nodeType === ELEMENT_NODE &&
          computeInteractivity(
            tagName,
            attributes,
            computedStyles,
            clickableIndexes.has(index),
          ),
        bounds,
        cursor: computedStyles.cursor,
        paintOrder,
        shadowRootType: shadowTypeByIndex.get(index),
        computedStyles,
        inIframe: documentIndex > 0,
        ignoredByPaintOrder: false,
      });
    }
  });

  return result;
}

async function readDevicePixelRatio(page: Page): Promise<number> {
  try {
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    return typeof ratio === 'number' && ratio > 0 ? ratio : 1;
  } catch {
    return 1;
  }
}

export async function readSnapshot(
  page: Page,
  options?: {devicePixelRatio?: number},
): Promise<SnapshotNode[]> {
  const devicePixelRatio =
    options?.devicePixelRatio ?? (await readDevicePixelRatio(page));
  const raw = await withCdpSession(page, client =>
    client.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [...REQUIRED_COMPUTED_STYLES],
      includePaintOrder: true,
      includeDOMRects: true,
    }),
  );
  return parseSnapshot(raw as unknown as RawSnapshot, devicePixelRatio);
}
