# DOM 快照读取与点击可靠性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 CDP `DOMSnapshot.captureSnapshot` 替代 `find_clickable_elements` 的 JS 启发式，并把 `click_at` 的落点解析升级为 CDP 四层降级（支持全部定位器，滚动保护与原生遮挡检测）。

**Architecture:** 新增纯函数解析层 `SnapshotReader`（快照 JSON → 扁平 `SnapshotNode[]`，聚合子文本节点）与 `clickPoint` 落点解析器（Playwright ElementHandle → CDP `objectId` → 可见 quad 降级）。工具层保持 `ClickableElement` 契约不变。

**Tech Stack:** TypeScript ESM、Node `node:test`、Patchright `CDPSession`、CDP DOM/DOMSnapshot/Input/Page 域。

**Spec:** `docs/superpowers/specs/2026-09-14-dom-snapshot-reader-design.md`

## Global Constraints

- Node 版本：`^20.19.0 || ^22.12.0 || >=23`。
- TypeScript ESM；类型导入/导出必须显式（`import type`）；优先 `interface`；Node 内置模块用 `node:` 前缀。
- Prettier：`singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`。
- 不新增任何 npm 依赖。
- 不引入 JS 注入到新读取路径（`DOMSnapshot` 为纯 CDP 只读）。
- `ClickableElement` 返回契约不变：`{selector, text, type: 'button' | 'link' | 'input' | 'other', visible, boundingBox?}`；`type` 沿用旧实现规则 `a → 'link'`，其余 → `'button'`。
- 测试目录镜像源码：`src/modules/dom/X.ts` → `tests/unit/modules/dom/X.test.ts`。
- 每个任务结束时运行：`npm run typecheck`、`npm run test:unit`、`npm run check-format`。
- 提交信息用 Conventional Commits，不加署名。

---

### Task 1: SnapshotReader 解析层（扁平化 / 文本 / 可见性）

**Files:**
- Create: `src/modules/dom/SnapshotReader.ts`
- Test: `tests/unit/modules/dom/SnapshotReader.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces:
  - `interface SnapshotBounds { x: number; y: number; width: number; height: number }`
  - `interface SnapshotNode { backendNodeId: number; tagName: string; attributes: Record<string,string>; text: string; isVisible: boolean; isInteractive: boolean; bounds?: SnapshotBounds; cursor?: string; paintOrder?: number; shadowRootType?: string; computedStyles: Record<string,string>; inIframe: boolean; ignoredByPaintOrder: boolean }`
  - `const REQUIRED_COMPUTED_STYLES: readonly string[]`
  - `interface RawSnapshot { strings?: string[]; documents?: RawDocument[] }`
  - `function parseSnapshot(raw: RawSnapshot, devicePixelRatio?: number): SnapshotNode[]`
  - `function readSnapshot(page: Page, options?: {devicePixelRatio?: number}): Promise<SnapshotNode[]>`

- [ ] **Step 1: Write the failing test**

创建 `tests/unit/modules/dom/SnapshotReader.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  parseSnapshot,
  REQUIRED_COMPUTED_STYLES,
  type RawSnapshot,
} from '../../../../src/modules/dom/SnapshotReader.js';

class StringTable {
  readonly values: string[] = [];
  add(value: string): number {
    const existing = this.values.indexOf(value);
    if (existing >= 0) return existing;
    this.values.push(value);
    return this.values.length - 1;
  }
}

interface NodeSpec {
  nodeType?: number;
  tagName?: string;
  backendNodeId: number;
  parentIndex?: number;
  attributes?: Record<string, string>;
  nodeValue?: string;
  textValue?: string;
  inputValue?: string;
  shadowRootType?: string;
  clickable?: boolean;
  bounds?: [number, number, number, number];
  styles?: Record<string, string>;
  paintOrder?: number;
}

/** 按 CDP captureSnapshot 的列式结构拼装合成快照，测试无需浏览器。 */
function buildSnapshot(specs: NodeSpec[]): RawSnapshot {
  const strings = new StringTable();
  const nodeType: number[] = [];
  const nodeName: number[] = [];
  const nodeValue: number[] = [];
  const backendNodeId: number[] = [];
  const parentIndex: number[] = [];
  const attributes: number[][] = [];
  const clickableIndex: number[] = [];
  const textValueIndex: number[] = [];
  const textValueValue: number[] = [];
  const inputValueIndex: number[] = [];
  const inputValueValue: number[] = [];
  const shadowIndex: number[] = [];
  const shadowValue: number[] = [];
  const layoutNodeIndex: number[] = [];
  const bounds: number[][] = [];
  const styles: number[][] = [];
  const paintOrders: number[] = [];

  specs.forEach((spec, index) => {
    nodeType.push(spec.nodeType ?? 1);
    nodeName.push(strings.add(spec.tagName ?? 'div'));
    nodeValue.push(spec.nodeValue === undefined ? -1 : strings.add(spec.nodeValue));
    backendNodeId.push(spec.backendNodeId);
    parentIndex.push(spec.parentIndex ?? -1);

    const flat: number[] = [];
    for (const [name, value] of Object.entries(spec.attributes ?? {})) {
      flat.push(strings.add(name), strings.add(value));
    }
    attributes.push(flat);

    if (spec.clickable) clickableIndex.push(index);
    if (spec.textValue !== undefined) {
      textValueIndex.push(index);
      textValueValue.push(strings.add(spec.textValue));
    }
    if (spec.inputValue !== undefined) {
      inputValueIndex.push(index);
      inputValueValue.push(strings.add(spec.inputValue));
    }
    if (spec.shadowRootType !== undefined) {
      shadowIndex.push(index);
      shadowValue.push(strings.add(spec.shadowRootType));
    }
    if (spec.bounds) {
      layoutNodeIndex.push(index);
      bounds.push([...spec.bounds]);
      styles.push(
        REQUIRED_COMPUTED_STYLES.map(name => strings.add(spec.styles?.[name] ?? '')),
      );
      paintOrders.push(spec.paintOrder ?? 0);
    }
  });

  return {
    strings: strings.values,
    documents: [
      {
        nodes: {
          nodeType,
          nodeName,
          nodeValue,
          backendNodeId,
          parentIndex,
          attributes,
          isClickable: {index: clickableIndex},
          textValue: {index: textValueIndex, value: textValueValue},
          inputValue: {index: inputValueIndex, value: inputValueValue},
          shadowRootType: {index: shadowIndex, value: shadowValue},
        },
        layout: {nodeIndex: layoutNodeIndex, bounds, styles, paintOrders},
      },
    ],
  } as unknown as RawSnapshot;
}

const VISIBLE_STYLES = {display: 'block', visibility: 'visible', opacity: '1'};

describe('parseSnapshot', () => {
  it('flattens element nodes with attributes and bounds', () => {
    const raw = buildSnapshot([
      {backendNodeId: 1, tagName: 'body'},
      {
        backendNodeId: 7,
        tagName: 'div',
        parentIndex: 0,
        attributes: {id: 'root', class: 'a b'},
        bounds: [10, 20, 100, 40],
        styles: VISIBLE_STYLES,
      },
    ]);

    const nodes = parseSnapshot(raw, 1);
    const target = nodes.find(node => node.backendNodeId === 7);

    assert.ok(target);
    assert.equal(target.tagName, 'div');
    assert.equal(target.attributes.id, 'root');
    assert.deepEqual(target.bounds, {x: 10, y: 20, width: 100, height: 40});
    assert.equal(target.isVisible, true);
    assert.equal(target.inIframe, false);
  });

  it('divides snapshot bounds by device pixel ratio', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 3,
        tagName: 'span',
        bounds: [20, 40, 200, 80],
        styles: VISIBLE_STYLES,
      },
    ]);

    const [node] = parseSnapshot(raw, 2);
    assert.deepEqual(node?.bounds, {x: 10, y: 20, width: 100, height: 40});
  });

  it('aggregates descendant text into the element text', () => {
    const raw = buildSnapshot([
      {backendNodeId: 1, tagName: 'button', styles: VISIBLE_STYLES},
      {
        backendNodeId: 2,
        nodeType: 3,
        nodeValue: '提交',
        parentIndex: 0,
      },
      {
        backendNodeId: 3,
        nodeType: 3,
        nodeValue: '答案',
        parentIndex: 0,
      },
    ]);

    const [button] = parseSnapshot(raw, 1);
    assert.equal(button?.text, '提交答案');
  });

  it('prefers live form values over descendant text', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 5,
        tagName: 'textarea',
        inputValue: '已输入内容',
        styles: VISIBLE_STYLES,
        bounds: [0, 0, 50, 20],
      },
    ]);

    const [node] = parseSnapshot(raw, 1);
    assert.equal(node?.text, '已输入内容');
  });

  it('marks display:none and zero-area nodes as not visible', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'div',
        bounds: [0, 0, 10, 10],
        styles: {display: 'none'},
      },
      {
        backendNodeId: 2,
        tagName: 'div',
        bounds: [0, 0, 0, 0],
        styles: VISIBLE_STYLES,
      },
      {backendNodeId: 3, tagName: 'div', styles: VISIBLE_STYLES},
    ]);

    const nodes = parseSnapshot(raw, 1);
    assert.equal(nodes[0]?.isVisible, false);
    assert.equal(nodes[1]?.isVisible, false);
    assert.equal(nodes[2]?.isVisible, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/dom/SnapshotReader.test.js`
Expected: FAIL — `Cannot find module '../../../../src/modules/dom/SnapshotReader.js'`

- [ ] **Step 3: Write minimal implementation**

创建 `src/modules/dom/SnapshotReader.ts`：

```ts
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
  computedStyles: Record<string, string>,
  bounds: SnapshotBounds | undefined,
): boolean {
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
      const liveValue =
        textValueByIndex.get(index) ?? inputValueByIndex.get(index) ?? '';
      const text =
        nodeType === TEXT_NODE
          ? str(nodeValues[index], strings).trim()
          : liveValue || collectText(index);

      result.push({
        backendNodeId,
        tagName,
        attributes,
        text,
        isVisible:
          nodeType === ELEMENT_NODE && computeVisibility(computedStyles, bounds),
        isInteractive: clickableIndexes.has(index),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/dom/SnapshotReader.test.js`
Expected: PASS（5 个用例）

- [ ] **Step 5: Verify snapshot coordinate space against a real page**

`DOMSnapshot` 的 `bounds` 单位在不同 Chrome 版本间有差异（CSS px 与 device px 之争）。若手边有可用浏览器，打开任意页面后比较同一元素的快照 `bounds` 与 `getBoundingClientRect()`：

```js
// 在 build 目录下执行；若无浏览器可跳过，改为在代码评审时标注待实测
// 比较结果：
//   两者一致      → parseSnapshot 的 DPR 除数正确
//   快照为 CSS px → readSnapshot 传 {devicePixelRatio: 1}
```

把结论写入 `docs/superpowers/specs/2026-09-14-dom-snapshot-reader-design.md` §10.4 下方一行备注。

- [ ] **Step 6: Commit**

```bash
git add src/modules/dom/SnapshotReader.ts tests/unit/modules/dom/SnapshotReader.test.ts docs/superpowers/specs/2026-09-14-dom-snapshot-reader-design.md
git commit -m "feat(dom): add CDP snapshot parser for flat element nodes"
```

---

### Task 2: 交互性判定与敏感字段剔除

**Files:**
- Modify: `src/modules/dom/SnapshotReader.ts`
- Test: `tests/unit/modules/dom/SnapshotReader.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `parseSnapshot`、`SnapshotNode`。
- Produces: `parseSnapshot` 的 `isInteractive` 升级为多级判定；敏感字段的值不出现在 `attributes.value` 与 `text` 中。

- [ ] **Step 1: Write the failing test**

在 `tests/unit/modules/dom/SnapshotReader.test.ts` 末尾追加：

```ts
describe('interactivity and sensitive fields', () => {
  it('marks nodes interactive from snapshot isClickable', () => {
    const raw = buildSnapshot([
      {backendNodeId: 1, tagName: 'div', clickable: true, styles: VISIBLE_STYLES, bounds: [0, 0, 10, 10]},
    ]);
    assert.equal(parseSnapshot(raw, 1)[0]?.isInteractive, true);
  });

  it('marks nodes interactive by cursor pointer, tag, role and tabindex', () => {
    const raw = buildSnapshot([
      {backendNodeId: 1, tagName: 'div', styles: {...VISIBLE_STYLES, cursor: 'pointer'}},
      {backendNodeId: 2, tagName: 'button', styles: VISIBLE_STYLES},
      {backendNodeId: 3, tagName: 'div', attributes: {role: 'menuitem'}, styles: VISIBLE_STYLES},
      {backendNodeId: 4, tagName: 'div', attributes: {tabindex: '0'}, styles: VISIBLE_STYLES},
      {backendNodeId: 5, tagName: 'div', attributes: {onclick: 'go()'}, styles: VISIBLE_STYLES},
      {backendNodeId: 6, tagName: 'div', styles: VISIBLE_STYLES},
    ]);

    const nodes = parseSnapshot(raw, 1);
    assert.deepEqual(
      nodes.map(node => node.isInteractive),
      [true, true, true, true, true, false],
    );
  });

  it('keeps zero-size file inputs visible', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'input',
        attributes: {type: 'file'},
        bounds: [0, 0, 0, 0],
        styles: {...VISIBLE_STYLES, opacity: '0'},
      },
    ]);

    const [node] = parseSnapshot(raw, 1);
    assert.equal(node?.isVisible, true);
    assert.equal(node?.isInteractive, true);
  });

  it('never exposes password values in attributes or text', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'input',
        attributes: {type: 'password', value: 'hunter2', placeholder: '密码'},
        inputValue: 'hunter2',
        styles: VISIBLE_STYLES,
        bounds: [0, 0, 120, 24],
      },
    ]);

    const [node] = parseSnapshot(raw, 1);
    assert.equal(node?.attributes.value, undefined);
    assert.equal(node?.text, '');
    assert.equal(JSON.stringify(node).includes('hunter2'), false);
  });

  it('scrubs credit-card and one-time-code autocomplete values', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'input',
        attributes: {autocomplete: 'cc-number', value: '4111111111111111'},
        inputValue: '4111111111111111',
        styles: VISIBLE_STYLES,
        bounds: [0, 0, 120, 24],
      },
    ]);

    const [node] = parseSnapshot(raw, 1);
    assert.equal(JSON.stringify(node).includes('4111111111111111'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/dom/SnapshotReader.test.js`
Expected: FAIL — `isInteractive` 恒为 `false`（仅 `isClickable` 判定），密码用例断言 `hunter2` 泄漏

- [ ] **Step 3: Write minimal implementation**

在 `src/modules/dom/SnapshotReader.ts` 中，`ELEMENT_NODE`/`TEXT_NODE` 常量下方加入：

```ts
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
  return tagName === 'input' && (attributes.type ?? '').toLowerCase() === 'file';
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
  if (EVENT_ATTRIBUTES.some(name => attributes[name] !== undefined)) return true;
  const role = (attributes.role ?? '').toLowerCase();
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (attributes.tabindex !== undefined) return true;
  return false;
}
```

把 `computeVisibility` 改为接受 tagName 与 attributes，并放行 file input：

```ts
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
```

在解析循环里，把 `liveValue` / `text` / `isVisible` / `isInteractive` 四段替换为：

```ts
      const sensitive = isSensitiveField(attributes);
      if (sensitive) {
        delete attributes.value;
        delete attributes.valuetext;
      }
      const liveValue = sensitive
        ? ''
        : textValueByIndex.get(index) ?? inputValueByIndex.get(index) ?? '';
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/dom/SnapshotReader.test.js`
Expected: PASS（10 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/modules/dom/SnapshotReader.ts tests/unit/modules/dom/SnapshotReader.test.ts
git commit -m "feat(dom): detect interactivity and scrub sensitive snapshot values"
```

---

### Task 3: find_clickable_elements 切换到快照数据源

**Files:**
- Modify: `src/tools/dom/findClickableElements.ts`
- Modify: `tests/unit/tools/findClickableElements.test.ts`（整体重写为 CDP mock）
- Modify: `tests/unit/tools/jshook-tools.handlers.test.ts`（`mockFrame` 补 `page()`，CDP mock 支持快照）

**Interfaces:**
- Consumes: `readSnapshot`、`SnapshotNode`（Task 1/2）。
- Produces: `find_clickable_elements` 工具行为不变（同样的 `ClickableElement[]`），数据源改为快照；快照失败时回退旧 JS 启发式并在 `message` 标注。

- [ ] **Step 1: Write the failing test**

用以下内容整体替换 `tests/unit/tools/findClickableElements.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {findClickableElements} from '../../../src/tools/dom/findClickableElements.js';

/** 合成快照：一个 id 按钮 + 一个 class 链接 + 一个普通 div。 */
function makeSnapshot() {
  // 索引：0 body · 1 button · 2 div · 3 a · 4 id · 5 submit-btn
  //       6 提交答案 · 7 查看详情 · 8 block · 9 visible · 10 1
  const strings = [
    'body',
    'button',
    'div',
    'a',
    'id',
    'submit-btn',
    '提交答案',
    '查看详情',
    'block',
    'visible',
    '1',
  ];
  return {
    strings,
    documents: [
      {
        nodes: {
          nodeType: [1, 1, 1, 1, 3, 3],
          nodeName: [0, 1, 2, 3, 0, 0],
          nodeValue: [-1, -1, -1, -1, 6, 7],
          backendNodeId: [1, 2, 3, 4, 5, 6],
          parentIndex: [-1, 0, 0, 0, 1, 3],
          attributes: [[], [4, 5], [], [], [], []],
          isClickable: {index: [1, 3]},
        },
        layout: {
          nodeIndex: [0, 1, 2, 3],
          bounds: [
            [0, 0, 800, 600],
            [10, 10, 100, 40],
            [10, 60, 100, 40],
            [10, 110, 100, 40],
          ],
          styles: [
            [8, 9, 10],
            [8, 9, 10],
            [8, 9, 10],
            [8, 9, 10],
          ],
          paintOrders: [0, 1, 2, 3],
        },
      },
    ],
  };
}

function makeContext() {
  const cdpClient = {
    send: async (method: string) => {
      if (method === 'DOMSnapshot.captureSnapshot') return makeSnapshot();
      return {};
    },
    detach: async () => undefined,
  };
  const page = {
    context: () => ({newCDPSession: async () => cdpClient}),
    evaluate: async () => 1,
  };
  return {getSelectedFrame: () => ({page: () => page})} as never;
}

test('maps snapshot nodes to clickable elements', async () => {
  let structuredContent: Record<string, unknown> | undefined;
  await findClickableElements.handler(
    {params: {}} as never,
    {
      setStructuredContent: content => {
        structuredContent = content as Record<string, unknown>;
      },
    } as never,
    makeContext(),
  );

  const data = structuredContent?.data as Array<Record<string, unknown>>;
  assert.deepEqual(
    data.map(item => item.text),
    ['提交答案', '查看详情'],
  );
  assert.equal(data[0]?.selector, '#submit-btn');
  assert.equal(data[0]?.type, 'button');
  assert.equal(data[1]?.type, 'link');
  assert.deepEqual(data[0]?.boundingBox, {
    x: 10,
    y: 10,
    width: 100,
    height: 40,
  });
});

test('filters by text and falls back to the JS heuristic when the snapshot fails', async () => {
  let structuredContent: Record<string, unknown> | undefined;
  const failingClient = {
    send: async () => {
      throw new Error('DOMSnapshot unavailable');
    },
    detach: async () => undefined,
  };
  const fallbackFrame = {
    page: () => ({
      context: () => ({newCDPSession: async () => failingClient}),
      evaluate: async () => 1,
    }),
    evaluate: async () => [
      {selector: '#fallback', text: '回退按钮', type: 'button', visible: true},
    ],
  };

  await findClickableElements.handler(
    {params: {filterText: '回退'}} as never,
    {
      setStructuredContent: content => {
        structuredContent = content as Record<string, unknown>;
      },
    } as never,
    {getSelectedFrame: () => fallbackFrame} as never,
  );

  const data = structuredContent?.data as Array<Record<string, unknown>>;
  assert.equal(data.length, 1);
  assert.equal(data[0]?.selector, '#fallback');
  assert.match(String(structuredContent?.message), /fallback/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/findClickableElements.test.js`
Expected: FAIL — 工具仍走 `frame.evaluate`，`makeContext` 的 frame 没有 `evaluate`，抛 `Failed to find clickable elements`

- [ ] **Step 3: Write minimal implementation**

在 `src/tools/dom/findClickableElements.ts` 顶部导入区加入：

```ts
import {readSnapshot, type SnapshotNode} from '../../modules/dom/SnapshotReader.js';
```

把 handler 的 `try/catch` 块整体替换为：

```ts
    let nodes: SnapshotNode[] = [];
    let degraded = false;
    try {
      nodes = await readSnapshot(frame.page());
    } catch {
      degraded = true;
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
```

在文件底部 `findClickableCode` 之前加入映射函数：

```ts
/** 由快照节点生成与旧实现一致的 CSS 选择器。 */
function buildSelector(node: SnapshotNode): string {
  const id = node.attributes.id;
  if (id) return `#${id}`;
  const firstClass = (node.attributes.class ?? '')
    .split(/\s+/)
    .filter(Boolean)[0];
  if (firstClass) return `${node.tagName}.${firstClass}`;
  return node.tagName;
}

/** 保持 ClickableElement 契约不变：a → link，其余 → button。 */
function mapNodesToClickable(
  nodes: SnapshotNode[],
  filterText?: string,
): ClickableElement[] {
  const lowered = filterText?.toLowerCase();
  const elements: ClickableElement[] = [];
  for (const node of nodes) {
    if (!node.isVisible || !node.isInteractive) continue;
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
```

- [ ] **Step 4: Update the shared harness mock**

在 `tests/unit/tools/jshook-tools.handlers.test.ts` 中，把 `mockFrame` 定义改为带 `page()`：

```ts
const mockFrame = {
  page: () => defaultMockPage,
  locator: () => createMockLocator(),
  evaluate: async (fnOrScript: unknown) => {
    if (typeof fnOrScript === 'function') {
      const fnStr = fnOrScript.toString();
      if (fnStr.includes('__hookStore')) {
        throw new Error('No in-page hook store');
      }
      return {
        found: true,
        nodeName: 'DIV',
        elements: [{found: true, nodeName: 'SPAN'}],
      };
    }
    if (typeof fnOrScript === 'string' && fnOrScript.includes('__hookStore')) {
      throw new Error('No in-page hook store');
    }
    return {
      found: true,
      nodeName: 'DIV',
      elements: [{found: true, nodeName: 'SPAN'}],
    };
  },
};
```

注意 `defaultMockPage` 必须声明在 `mockFrame` 之前——把 `defaultMockPage` 的 `const` 声明上移到 `mockFrame` 之前，并把 `defaultMockPage.context().newCDPSession` 的返回值补上 `detach`：

```ts
  context: () => ({
    cookies: async () => [],
    clearCookies: async () => undefined,
    addCookies: async () => undefined,
    newCDPSession: async () => ({
      send: async () => ({}),
      detach: async () => undefined,
    }),
  }),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/findClickableElements.test.js build/tests/unit/tools/jshook-tools.handlers.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/dom/findClickableElements.ts tests/unit/tools/findClickableElements.test.ts tests/unit/tools/jshook-tools.handlers.test.ts
git commit -m "feat(dom): source clickable elements from CDP snapshot with JS fallback"
```

---

### Task 4: 点击落点解析器 clickPoint

**Files:**
- Create: `src/modules/browser/clickPoint.ts`
- Test: `tests/unit/modules/browser/clickPoint.test.ts`

**Interfaces:**
- Consumes: `CDPSession`、`Frame`、`Page`。
- Produces:
  - `type ClickSource = 'contentQuads' | 'boxModel' | 'boundingRect'`
  - `type ClickResolution = {kind: 'point'; x: number; y: number; source: ClickSource; quadCount: number} | {kind: 'jsClick'}`
  - `function resolveClickPoint(frame: Frame, selector: string, options?: {viewport?: Viewport}): Promise<ClickResolution>`

- [ ] **Step 1: Write the failing test**

创建 `tests/unit/modules/browser/clickPoint.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {resolveClickPoint} from '../../../../src/modules/browser/clickPoint.js';

interface SendCall {
  method: string;
  params?: Record<string, unknown>;
}

function makeClient(
  handlers: Record<string, (params?: Record<string, unknown>) => unknown>,
): {calls: SendCall[]; send: (method: string, params?: Record<string, unknown>) => Promise<unknown>} {
  const calls: SendCall[] = [];
  return {
    calls,
    send: async (method, params) => {
      calls.push({method, params});
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP method ${method}`);
      return handler(params);
    },
  };
}

const VIEWPORT = {width: 800, height: 600};

function makeMockFrame(client: unknown, options?: {
  scrollFails?: boolean;
  boundingBox?: {x: number; y: number; width: number; height: number};
  noElement?: boolean;
}) {
  let scrolled = false;
  return {
    getScrolled: () => scrolled,
    page: () => ({
      context: () => ({newCDPSession: async () => client}),
      evaluate: async () => 1,
    }),
    locator: (selector: string) => ({
      scrollIntoViewIfNeeded: async () => {
        if (options?.scrollFails) throw new Error('scroll failed');
        scrolled = true;
      },
      elementHandle: async () => {
        if (options?.noElement) return null;
        return {
          _remoteObject: () => ({objectId: 'remote-obj-1'}),
          evaluate: async (fn: (el: unknown) => unknown) => {
            const rect = options?.boundingBox ?? {x: 10, y: 20, width: 100, height: 40};
            return rect;
          },
        };
      },
    }),
  };
}

describe('resolveClickPoint', () => {
  it('scrolls into view and picks largest visible quad for any locator (CSS/role/text)', async () => {
    const client = makeClient({
      'Page.getLayoutMetrics': () => ({cssLayoutViewport: {clientWidth: 800, clientHeight: 600}}),
      'DOM.getContentQuads': () => ({
        quads: [
          [900, 900, 920, 900, 920, 920, 900, 920],
          [-10, 10, 90, 10, 90, 50, -10, 50],
        ],
      }),
    });
    const frame = makeMockFrame(client);

    const result = await resolveClickPoint(frame as never, 'role=button[name="提交"]');

    assert.equal(frame.getScrolled(), true);
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'contentQuads');
    assert.equal(result.quadCount, 2);
    assert.equal(result.x, 40);
    assert.equal(result.y, 30);
  });

  it('falls back to boxModel when content quads are empty', async () => {
    const client = makeClient({
      'Page.getLayoutMetrics': () => ({cssLayoutViewport: {clientWidth: 800, clientHeight: 600}}),
      'DOM.getContentQuads': () => ({quads: []}),
      'DOM.getBoxModel': () => ({
        model: {content: [10, 20, 110, 20, 110, 60, 10, 60]},
      }),
    });
    const frame = makeMockFrame(client);

    const result = await resolveClickPoint(frame as never, '#btn');
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'boxModel');
    assert.equal(result.x, 60);
    assert.equal(result.y, 40);
  });

  it('falls back to getBoundingClientRect when quads and boxModel fail', async () => {
    const client = makeClient({
      'Page.getLayoutMetrics': () => ({cssLayoutViewport: {clientWidth: 800, clientHeight: 600}}),
      'DOM.getContentQuads': () => ({quads: []}),
      'DOM.getBoxModel': () => {
        throw new Error('no box model');
      },
    });
    const frame = makeMockFrame(client, {boundingBox: {x: 100, y: 200, width: 50, height: 20}});

    const result = await resolveClickPoint(frame as never, '#btn');
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'boundingRect');
    assert.equal(result.x, 125);
    assert.equal(result.y, 210);
  });

  it('reports jsClick when locator cannot find element handle', async () => {
    const client = makeClient({});
    const frame = makeMockFrame(client, {noElement: true});

    const result = await resolveClickPoint(frame as never, '#missing');
    assert.deepEqual(result, {kind: 'jsClick'});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/browser/clickPoint.test.js`
Expected: FAIL — `Cannot find module '../../../../src/modules/browser/clickPoint.js'`

- [ ] **Step 3: Write minimal implementation**

创建 `src/modules/browser/clickPoint.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 点击落点解析：CDP 四层降级，优先返回元素实际可见区域的中心。
 *
 * 1. locator.scrollIntoViewIfNeeded() — 确保滚入视口，防止被截断误触
 * 2. 通过 ElementHandle 获取 CDP objectId — 原生支持所有定位器（CSS/role/text/xpath）
 * 3. DOM.getContentQuads — 选视口内最大可见 quad
 * 4. DOM.getBoxModel    — 降级 content 八元组
 * 5. getBoundingClientRect — 降级 JS 矩形
 * 6. 全部失败           — 返回 jsClick
 */

import type {CDPSession, Frame} from '../../third_party/index.js';
import {withCdpSession} from './cdpUtils.js';

export type ClickSource = 'contentQuads' | 'boxModel' | 'boundingRect';

export type ClickResolution =
  | {
      kind: 'point';
      x: number;
      y: number;
      source: ClickSource;
      quadCount: number;
    }
  | {kind: 'jsClick'};

export interface Viewport {
  width: number;
  height: number;
}

type Quad = number[];

function quadCenter(quad: Quad): {x: number; y: number} {
  let x = 0;
  let y = 0;
  let count = 0;
  for (let i = 0; i + 1 < quad.length; i += 2) {
    x += quad[i];
    y += quad[i + 1];
    count += 1;
  }
  if (count === 0) return {x: 0, y: 0};
  return {x: x / count, y: y / count};
}

function quadBounds(quad: Quad): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < quad.length; i += 2) {
    xs.push(quad[i]);
    ys.push(quad[i + 1]);
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function visibleArea(quad: Quad, viewport: Viewport): number {
  const {minX, minY, maxX, maxY} = quadBounds(quad);
  if (viewport.width <= 0 || viewport.height <= 0) {
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  }
  const width = Math.min(viewport.width, maxX) - Math.max(0, minX);
  const height = Math.min(viewport.height, maxY) - Math.max(0, minY);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function clamp(value: number, max: number): number {
  if (max <= 0) return Math.max(0, value);
  return Math.max(0, Math.min(max - 1, value));
}

async function readViewport(client: CDPSession): Promise<Viewport> {
  try {
    const metrics = await client.send('Page.getLayoutMetrics', {});
    const viewport = metrics.cssLayoutViewport;
    return {
      width: viewport?.clientWidth ?? 0,
      height: viewport?.clientHeight ?? 0,
    };
  } catch {
    return {width: 0, height: 0};
  }
}

export async function resolveClickPoint(
  frame: Frame,
  selector: string,
  options?: {viewport?: Viewport},
): Promise<ClickResolution> {
  const locator = frame.locator(selector);

  // 1. 强制滚动入视口，防止被视口 clamp 截断点偏
  try {
    await locator.scrollIntoViewIfNeeded({timeout: 3000});
  } catch {
    // 滚动超时或失败不直接打断，继续尝试获取 handle
  }

  let handle: any;
  try {
    handle = await locator.elementHandle({timeout: 3000});
  } catch {
    return {kind: 'jsClick'};
  }
  if (!handle) return {kind: 'jsClick'};

  const objectId = handle._remoteObject?.()?.objectId;

  return await withCdpSession(frame.page(), async client => {
    const viewport = options?.viewport ?? (await readViewport(client));

    if (objectId) {
      // 2. 优先尝试 DOM.getContentQuads
      try {
        const response = await client.send('DOM.getContentQuads', {objectId});
        const quads = response.quads ?? [];
        if (quads.length > 0) {
          const best = quads.reduce((current, candidate) =>
            visibleArea(candidate, viewport) > visibleArea(current, viewport)
              ? candidate
              : current,
          );
          const center = quadCenter(best);
          return {
            kind: 'point',
            x: clamp(center.x, viewport.width),
            y: clamp(center.y, viewport.height),
            source: 'contentQuads',
            quadCount: quads.length,
          };
        }
      } catch {
        // 继续降级到 boxModel
      }

      // 3. 降级 DOM.getBoxModel
      try {
        const model = await client.send('DOM.getBoxModel', {objectId});
        const content = model.model?.content;
        if (content && content.length >= 8) {
          const center = quadCenter(content);
          return {
            kind: 'point',
            x: clamp(center.x, viewport.width),
            y: clamp(center.y, viewport.height),
            source: 'boxModel',
            quadCount: 1,
          };
        }
      } catch {
        // 继续降级到 boundingRect
      }
    }

    // 4. 降级 getBoundingClientRect
    try {
      const rect = await handle.evaluate((el: Element) => {
        const r = el.getBoundingClientRect();
        return {x: r.left, y: r.top, width: r.width, height: r.height};
      });
      if (rect) {
        return {
          kind: 'point',
          x: clamp(rect.x + rect.width / 2, viewport.width),
          y: clamp(rect.y + rect.height / 2, viewport.height),
          source: 'boundingRect',
          quadCount: 0,
        };
      }
    } catch {
      // 失败转 jsClick
    }

    return {kind: 'jsClick'};
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/browser/clickPoint.test.js`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/modules/browser/clickPoint.ts tests/unit/modules/browser/clickPoint.test.ts
git commit -m "feat(browser): resolve click points via CDP quads supporting all locators"
```

---

### Task 5: click_at 与 PageInteraction.clickAt 接入落点解析

**Files:**
- Modify: `src/tools/input/clickAt.ts`
- Modify: `src/modules/collector/PageInteraction.ts:45-90`
- Test: `tests/unit/tools/input/clickAt.test.ts`（新建）
- Modify: `tests/unit/modules/PageController.test.ts`（追加 clickAt 覆盖）

**Interfaces:**
- Consumes: `resolveClickPoint`（Task 4）。
- Produces:
  - `click_at` 对全定位器（CSS / role= / text= / xpath= / >> nth=）统一走 CDP quad 精度解析。
  - `PageInteraction.clickAt` 返回结构不变：`{x: number; y: number; tag: string; text: string}`。

- [ ] **Step 1: Write the failing test**

创建 `tests/unit/tools/input/clickAt.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {clickAt} from '../../../src/tools/input/clickAt.js';

function makeResponse() {
  let structuredContent: Record<string, unknown> | undefined;
  return {
    response: {
      setStructuredContent: (content: unknown) => {
        structuredContent = content as Record<string, unknown>;
      },
    },
    getContent: () => structuredContent,
  };
}

function makeCdpClient() {
  const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
  return {
    calls,
    client: {
      send: async (method: string, params?: Record<string, unknown>) => {
        calls.push({method, params});
        switch (method) {
          case 'DOM.getContentQuads':
            return {quads: [[0, 0, 100, 0, 100, 50, 0, 50]]};
          case 'Page.getLayoutMetrics':
            return {cssLayoutViewport: {clientWidth: 800, clientHeight: 600}};
          default:
            return {};
        }
      },
      detach: async () => undefined,
    },
  };
}

function makeFrame(client: unknown) {
  return {
    page: () => ({
      context: () => ({newCDPSession: async () => client}),
      evaluate: async () => 1,
    }),
    locator: () => ({
      scrollIntoViewIfNeeded: async () => undefined,
      elementHandle: async () => ({
        _remoteObject: () => ({objectId: 'remote-1'}),
        evaluate: async () => ({x: 0, y: 0, width: 100, height: 50}),
      }),
      evaluate: async () => ({x: 50, y: 25, tag: 'BUTTON', text: '提交'}),
      click: async () => undefined,
    }),
  };
}

describe('click_at', () => {
  it('clicks at the resolved quad center for any locator', async () => {
    const {calls, client} = makeCdpClient();
    const {response, getContent} = makeResponse();

    await clickAt.handler(
      {params: {selector: 'role=button[name="提交"]'}} as never,
      response as never,
      {getSelectedFrame: () => makeFrame(client)} as never,
    );

    const pressed = calls.find(call => call.params?.type === 'mousePressed');
    assert.equal(pressed?.params?.x, 50);
    assert.equal(pressed?.params?.y, 25);
    assert.equal(
      (getContent()?.data as Record<string, unknown>)?.source,
      'contentQuads',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/input/clickAt.test.js`
Expected: FAIL — 当前实现只调 `getBoundingClientRect`，未产生 `DOM.getContentQuads` 调用

- [ ] **Step 3: Write minimal implementation**

用以下内容整体替换 `src/tools/input/clickAt.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {withCdpSession} from '../../modules/browser/cdpUtils.js';
import {resolveClickPoint} from '../../modules/browser/clickPoint.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {toElementError} from '../shared/elementLocator.js';
import {defineTool, type Context} from '../ToolDefinition.js';

/**
 * 通过 CDP 在元素坐标处派发真实鼠标点击事件。
 *
 * 全定位器（CSS / role= / text= / xpath= / >> nth=）均通过 CDP quad 选取视口内可见区域中心；
 * 并在点击前先滚动入视口以防点偏。
 */
export const clickAt = defineTool({
  name: 'click_at',
  description:
    '使用 CDP Input.dispatchMouseEvent 在元素中心坐标处派发真实鼠标点击事件，适用于 Playwright 点击被拦截的场景。会选取元素在视口内的最大可见区域中心。',
  annotations: {
    title: '坐标点击',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    selector: zod
      .string()
      .describe(
        '定位器：CSS（#id、.cls）、role=button[name="提交"]、text=登录、xpath=//button。多匹配时用 >> nth=N 消歧。',
      ),
  },
  handler: async (request, response, context) => {
    const {selector} = request.params;
    const frame = (context as Context).getSelectedFrame();

    try {
      const resolution = await resolveClickPoint(frame, selector);

      if (resolution.kind === 'jsClick') {
        await frame.locator(selector).click();
        response.setStructuredContent({
          success: true,
          message: `JS fallback click at ${selector}`,
          tooltype: 'click_at',
          data: {x: 0, y: 0, tag: '', text: '', source: 'jsClick'},
        });
        return;
      }

      await withCdpSession(frame.page(), async client => {
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: resolution.x,
          y: resolution.y,
          button: 'left',
          clickCount: 1,
        });
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: resolution.x,
          y: resolution.y,
          button: 'left',
          clickCount: 1,
        });
      });

      response.setStructuredContent({
        success: true,
        message: `Real mouse click at ${selector} (${resolution.x}, ${resolution.y}) via ${resolution.source}`,
        tooltype: 'click_at',
        data: {
          x: resolution.x,
          y: resolution.y,
          tag: '',
          text: '',
          source: resolution.source,
          quadCount: resolution.quadCount,
        },
      });
    } catch (error) {
      throw toElementError(error, {toolName: 'click_at', selector});
    }
  },
});
```

- [ ] **Step 4: Update PageInteraction.clickAt**

用以下内容替换 `src/modules/collector/PageInteraction.ts` 的 `clickAt`（第 41-90 行）：

```ts
/**
 * 🆕 真实鼠标点击 — CDP Input.dispatchMouseEvent
 * 算作用户真实手势，能触发文件对话框、绕过部分反自动化检测
 *
 * 落点由 resolveClickPoint 解析：视口内最大可见 quad 中心，逐层降级。
 */
export async function clickAt(
  page: Page,
  selector: string,
): Promise<{
  x: number;
  y: number;
  tag: string;
  text: string;
}> {
  const resolution = await resolveClickPoint(page.mainFrame(), selector);
  if (resolution.kind === 'jsClick') {
    throw new Error(`Element not found: ${selector}`);
  }

  await withCdpSession(page, async client => {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: resolution.x,
      y: resolution.y,
      button: 'left',
      clickCount: 1,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: resolution.x,
      y: resolution.y,
      button: 'left',
      clickCount: 1,
    });
  });

  const info = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el
      ? {tag: el.tagName, text: (el.textContent || '').slice(0, 100)}
      : {tag: '', text: ''};
  }, selector);

  logger.info(`Real mouse click at: ${selector} (${resolution.x}, ${resolution.y}) via ${resolution.source}`);
  return {x: resolution.x, y: resolution.y, ...info};
}
```

并在该文件导入区加入：

```ts
import {resolveClickPoint} from '../browser/clickPoint.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/input/clickAt.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/input/clickAt.ts src/modules/collector/PageInteraction.ts tests/unit/tools/input/clickAt.test.ts
git commit -m "fix(browser): unify click_at and PageInteraction on resolveClickPoint"
```

---

### Task 6: 原生 elementFromPoint 遮挡过滤

**Files:**
- Modify: `src/modules/browser/clickPoint.ts`
- Modify: `tests/unit/modules/browser/clickPoint.test.ts`（追加遮挡多 quad 切换用例）

**Interfaces:**
- Consumes: `ClickResolution`、`resolveClickPoint`。
- Produces: 当元素有多个 quads 且最大 quad 中心被浮层/弹窗遮挡时，通过 `document.elementFromPoint(x, y)` 自动切换到未遮挡的备选 quad。

- [ ] **Step 1: Write the failing test**

在 `tests/unit/modules/browser/clickPoint.test.ts` 追加用例：

```ts
  it('selects alternative quad when the primary quad is obscured by another topmost element', async () => {
    const client = makeClient({
      'Page.getLayoutMetrics': () => ({cssLayoutViewport: {clientWidth: 800, clientHeight: 600}}),
      'DOM.getContentQuads': () => ({
        quads: [
          [10, 10, 50, 10, 50, 50, 10, 50],   // quad 1: 面积 1600，但被遮挡
          [60, 10, 90, 10, 90, 40, 60, 40],   // quad 2: 面积 900，未遮挡
        ],
      }),
    });

    const frame = {
      page: () => ({
        context: () => ({newCDPSession: async () => client}),
        evaluate: async () => 1,
      }),
      locator: () => ({
        scrollIntoViewIfNeeded: async () => undefined,
        elementHandle: async () => ({
          _remoteObject: () => ({objectId: 'remote-1'}),
          evaluate: async (fn: any, args: any) => {
            // 模拟 elementFromPoint 检查：quad 1 (x:30, y:30) 被遮挡，quad 2 (x:75, y:25) 未遮挡
            if (args?.x === 30 && args?.y === 30) return false;
            return true;
          },
        }),
      }),
    };

    const result = await resolveClickPoint(frame as never, '#btn');
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.x, 75);
    assert.equal(result.y, 25);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/browser/clickPoint.test.js`
Expected: FAIL — 原实现直接取面积最大的 quad 1 (x:30, y:30)，没有遮挡回退。

- [ ] **Step 3: Implement occlusion check in clickPoint.ts**

在 `src/modules/browser/clickPoint.ts` 中加入原生遮挡判定 helper：

```ts
async function isQuadTopmost(
  handle: any,
  x: number,
  y: number,
): Promise<boolean> {
  try {
    return await handle.evaluate(
      (el: Element, point: {x: number; y: number}) => {
        const topEl = document.elementFromPoint(point.x, point.y);
        if (!topEl) return true;
        return el === topEl || el.contains(topEl) || topEl.contains(el);
      },
      {x, y},
    );
  } catch {
    return true;
  }
}
```

在 `DOM.getContentQuads` 处理块中：

```ts
      try {
        const response = await client.send('DOM.getContentQuads', {objectId});
        const quads = response.quads ?? [];
        if (quads.length > 0) {
          // 按可见面积从大到小排序
          const sorted = [...quads].sort(
            (a, b) => visibleArea(b, viewport) - visibleArea(a, viewport),
          );

          // 寻找第一个未被遮挡的 quad
          let chosen = sorted[0];
          for (const candidate of sorted) {
            const center = quadCenter(candidate);
            const topmost = await isQuadTopmost(handle, center.x, center.y);
            if (topmost) {
              chosen = candidate;
              break;
            }
          }

          const center = quadCenter(chosen);
          return {
            kind: 'point',
            x: clamp(center.x, viewport.width),
            y: clamp(center.y, viewport.height),
            source: 'contentQuads',
            quadCount: quads.length,
          };
        }
      } catch {
        // 继续降级到 boxModel
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/browser/clickPoint.test.js`
Expected: PASS（5 个用例）

- [ ] **Step 5: Run full verification suite**

Run: `npm run typecheck && npm run test:unit && npm run check-format`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/modules/browser/clickPoint.ts tests/unit/modules/browser/clickPoint.test.ts
git commit -m "feat(browser): add native elementFromPoint occlusion check for multi-quad targets"
```

---

## 完成标准

- `npm run typecheck`、`npm run test:unit`、`npm run check-format` 全绿。
- `find_clickable_elements` 在支持 `DOMSnapshot` 的浏览器上返回来自 CDP 的元素，基于 `parentIndex` 正确聚合文本，快照失败时回退并在 `message` 标注。
- `click_at` 对所有定位器（CSS/role/text/xpath）优先使用 CDP quad 落点，强制先滚动入视口，且原生检测遮挡。
- 密码 / 文件 / hidden / `cc-` / `one-time-code` 字段的值不出现在任何工具输出中。
- `PageInteraction.clickAt` 不再重复实现落点逻辑。

## 遗留项（不在本计划范围）

- `DOMInspector.findClickable()` 在阶段 1 标记 `@deprecated`；若 `runtime.domInspector` 在生产路径无调用方，单独开任务清理。
- iframe 内元素覆盖为 best-effort（spec §10.2）。
- 快照坐标空间需在 Task 1 Step 5 用真实浏览器确认（spec §10.4）。
