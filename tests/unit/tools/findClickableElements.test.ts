/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {findClickableElements} from '../../../src/tools/dom/findClickableElements.js';

interface FakeElement {
  tagName: string;
  textContent: string;
  id: string;
  className: string;
  cursor: string;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  getBoundingClientRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

function element(
  textContent: string,
  options: {
    tagName?: string;
    className?: string;
    cursor?: string;
    attributes?: Record<string, string>;
  } = {},
): FakeElement {
  const attributes = options.attributes ?? {};
  return {
    tagName: options.tagName ?? 'DIV',
    textContent,
    id: '',
    className: options.className ?? '',
    cursor: options.cursor ?? 'auto',
    attributes,
    getAttribute: name => attributes[name] ?? null,
    hasAttribute: name => name in attributes,
    getBoundingClientRect: () => ({x: 1, y: 2, width: 80, height: 24}),
  };
}

test('finds non-standard clickable containers', async () => {
  const elements = [
    element('提交答案', {
      className: 'left-content-button',
      attributes: {onclick: 'submit()'},
    }),
    element('继续', {attributes: {role: 'button'}}),
    element('查看详情', {cursor: 'pointer'}),
    element('普通文本'),
  ];
  let structuredContent: Record<string, unknown> | undefined;
  const frame = {
    evaluate: async (
      callback: (filter?: string) => unknown,
      filterText?: string,
    ) => {
      const originalDocument = globalThis.document;
      const originalWindow = globalThis.window;
      Object.assign(globalThis, {
        document: {
          querySelectorAll: (selector: string) =>
            selector === '*' ? elements : [],
        },
        window: {
          getComputedStyle: (target: FakeElement) => ({
            cursor: target.cursor,
            display: 'block',
            visibility: 'visible',
            opacity: '1',
          }),
        },
      });
      try {
        return callback(filterText);
      } finally {
        Object.assign(globalThis, {
          document: originalDocument,
          window: originalWindow,
        });
      }
    },
  };

  await findClickableElements.handler(
    {params: {}} as never,
    {
      setStructuredContent: content => {
        structuredContent = content as Record<string, unknown>;
      },
    } as never,
    {getSelectedFrame: () => frame} as never,
  );

  const data = structuredContent?.data as Array<Record<string, unknown>>;
  assert.deepEqual(
    data.map(item => item.text),
    ['提交答案', '继续', '查看详情'],
  );
  assert.equal(data[0]?.selector, 'div.left-content-button');
});
