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
  /** 视口坐标包围盒（CDP 的 bounds 为文档坐标，解析时已扣除所属文档滚动偏移）。 */
  bounds?: SnapshotBounds;
  cursor?: string;
  shadowRootType?: string;
  computedStyles: Record<string, string>;
  inIframe: boolean;
}

/** 仅请求判定交互性与可见性所需的计算样式，避免重站点上快照体积膨胀。 */
export const REQUIRED_COMPUTED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'cursor',
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
  // HTML autocomplete 是空格分隔的 token 列表（如 "billing cc-number"），逐 token 前缀匹配。
  const tokens = (attributes.autocomplete ?? '').toLowerCase().split(/\s+/);
  return SENSITIVE_AUTOCOMPLETE_PREFIXES.some(prefix =>
    tokens.some(token => token.startsWith(prefix)),
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
  // 无 href 的 <a> 是占位/锚点，不可点击，与 JS 降级路径口径保持一致
  if (tagName === 'a') return attributes.href !== undefined;
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
}

interface RawDocument {
  nodes?: RawNodeTree;
  layout?: RawLayoutTree;
  /** 文档滚动偏移，用于把 layout.bounds（文档坐标）换算为视口坐标。 */
  scrollOffsetX?: number;
  scrollOffsetY?: number;
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
  scrollOffsetX: number,
  scrollOffsetY: number,
): SnapshotBounds | undefined {
  if (!bounds || bounds.length < 4) return undefined;
  // layout.bounds 为文档坐标（含嵌套滚动容器偏移），扣除所属文档滚动偏移后即为视口坐标，
  // 与 getBoundingClientRect() 及 CDP Input.dispatchMouseEvent 的坐标系一致。
  return {
    x: bounds[0] - scrollOffsetX,
    y: bounds[1] - scrollOffsetY,
    width: bounds[2],
    height: bounds[3],
  };
}

function readStyles(
  styleIndexes: number[] | undefined,
  strings: string[],
): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleIndexes) return styles;
  // CDP 按请求顺序回填 styles，位置即 REQUIRED_COMPUTED_STYLES 的下标
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
  // file input 常被刻意隐藏（opacity:0 / 零尺寸）以便自定义样式，按设计仍需暴露给上层 setFiles
  if (isFileInput(tagName, attributes)) return true;
  if (computedStyles.display === 'none') return false;
  if (computedStyles.visibility === 'hidden') return false;
  if (computedStyles.opacity === '0') return false;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  return true;
}

export function parseSnapshot(raw: RawSnapshot): SnapshotNode[] {
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

    const attributesByIndex = backendIds.map((_, index) =>
      readAttributes(attributeLists[index], strings),
    );

    // 聚合文本按节点记忆化，单页 O(总文本量)。
    const rawTextCache = new Map<number, string>();
    const collectRawText = (index: number): string => {
      const cached = rawTextCache.get(index);
      if (cached !== undefined) return cached;
      let value = '';
      if (nodeTypes[index] === TEXT_NODE) {
        value = str(nodeValues[index], strings);
      } else {
        for (const child of childrenByParent.get(index) ?? []) {
          value += collectRawText(child);
        }
      }
      rawTextCache.set(index, value);
      return value;
    };

    // 敏感元素的后代文本节点同样要遮蔽：快照里 <textarea> 的服务端渲染内容
    // 是独立文本节点，自身没有 attributes，仅按自身属性判定会原样泄出。
    const isDescendantOfSensitive = (index: number): boolean => {
      let current = parentIndexes[index];
      while (typeof current === 'number' && current >= 0) {
        if (isSensitiveField(attributesByIndex[current] ?? {})) return true;
        current = parentIndexes[current];
      }
      return false;
    };

    for (let index = 0; index < backendIds.length; index += 1) {
      const backendNodeId = backendIds[index];
      if (typeof backendNodeId !== 'number') continue;

      const nodeType = nodeTypes[index] ?? 0;
      const tagName = str(nodeNames[index], strings).toLowerCase();
      const attributes = attributesByIndex[index] ?? {};
      const layoutIndex = layoutIndexByNode.get(index);
      const bounds = readBounds(
        layoutIndex === undefined ? undefined : layout.bounds?.[layoutIndex],
        document.scrollOffsetX ?? 0,
        document.scrollOffsetY ?? 0,
      );
      const computedStyles = readStyles(
        layoutIndex === undefined ? undefined : layout.styles?.[layoutIndex],
        strings,
      );
      const sensitive =
        isSensitiveField(attributes) ||
        (nodeType === TEXT_NODE && isDescendantOfSensitive(index));
      if (sensitive) {
        delete attributes.value;
        delete attributes.valuetext;
        delete attributes['aria-valuetext'];
      }
      const liveValue = sensitive
        ? ''
        : (textValueByIndex.get(index) ?? inputValueByIndex.get(index) ?? '');
      const text = sensitive
        ? ''
        : nodeType === TEXT_NODE
          ? str(nodeValues[index], strings).trim()
          : liveValue || collectRawText(index).trim();

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
        shadowRootType: shadowTypeByIndex.get(index),
        computedStyles,
        inIframe: documentIndex > 0,
      });
    }
  });

  return result;
}

export async function readSnapshot(page: Page): Promise<SnapshotNode[]> {
  // 当前只用 layout.bounds 与白名单 styles；includePaintOrder / includeDOMRects
  // 会额外返回 paintOrders 与三组矩形，徒增重站点快照体积，暂不开启。
  const raw = await withCdpSession(page, client =>
    client.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [...REQUIRED_COMPUTED_STYLES],
    }),
  );
  // client.send 的结果未被 third_party 的 CDP 类型约束，此处按实际协议形状断言。
  return parseSnapshot(raw as unknown as RawSnapshot);
}
