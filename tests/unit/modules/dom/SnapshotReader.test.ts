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
    nodeValue.push(
      spec.nodeValue === undefined ? -1 : strings.add(spec.nodeValue),
    );
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
        REQUIRED_COMPUTED_STYLES.map(name =>
          strings.add(spec.styles?.[name] ?? ''),
        ),
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

describe('interactivity and sensitive fields', () => {
  it('marks nodes interactive from snapshot isClickable', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'div',
        clickable: true,
        styles: VISIBLE_STYLES,
        bounds: [0, 0, 10, 10],
      },
    ]);
    assert.equal(parseSnapshot(raw, 1)[0]?.isInteractive, true);
  });

  it('marks nodes interactive by cursor pointer, tag, role and tabindex', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'div',
        bounds: [0, 0, 10, 10],
        styles: {...VISIBLE_STYLES, cursor: 'pointer'},
      },
      {
        backendNodeId: 2,
        tagName: 'button',
        bounds: [0, 0, 10, 10],
        styles: VISIBLE_STYLES,
      },
      {
        backendNodeId: 3,
        tagName: 'div',
        bounds: [0, 0, 10, 10],
        attributes: {role: 'menuitem'},
        styles: VISIBLE_STYLES,
      },
      {
        backendNodeId: 4,
        tagName: 'div',
        bounds: [0, 0, 10, 10],
        attributes: {tabindex: '0'},
        styles: VISIBLE_STYLES,
      },
      {
        backendNodeId: 5,
        tagName: 'div',
        bounds: [0, 0, 10, 10],
        attributes: {onclick: 'go()'},
        styles: VISIBLE_STYLES,
      },
      {
        backendNodeId: 6,
        tagName: 'div',
        bounds: [0, 0, 10, 10],
        styles: VISIBLE_STYLES,
      },
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

  it('scrubs token-list autocomplete like "billing cc-number"', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'input',
        attributes: {
          autocomplete: 'billing cc-number',
          value: '4111111111111111',
        },
        inputValue: '4111111111111111',
        styles: VISIBLE_STYLES,
        bounds: [0, 0, 120, 24],
      },
    ]);

    const [node] = parseSnapshot(raw, 1);
    assert.equal(JSON.stringify(node).includes('4111111111111111'), false);
  });

  it('scrubs one-time-code and valuetext in token-list autocomplete', () => {
    const raw = buildSnapshot([
      {
        backendNodeId: 1,
        tagName: 'input',
        attributes: {
          autocomplete: 'section-payment one-time-code',
          valuetext: '123456',
        },
        inputValue: '123456',
        styles: VISIBLE_STYLES,
        bounds: [0, 0, 120, 24],
      },
    ]);

    const [node] = parseSnapshot(raw, 1);
    assert.equal(node?.attributes.valuetext, undefined);
    assert.equal(JSON.stringify(node).includes('123456'), false);
  });
});
