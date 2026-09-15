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
