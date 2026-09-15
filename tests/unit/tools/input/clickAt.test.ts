/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {clickAt} from '../../../../src/tools/input/clickAt.js';

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
        return {};
      },
      detach: async () => undefined,
    },
  };
}

function makeFrame(client: unknown, options?: {noElement?: boolean}) {
  let clicked = false;
  const mockEl = {
    getClientRects: () => [
      {left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50},
    ],
    getBoundingClientRect: () => ({x: 0, y: 0, width: 100, height: 50}),
    contains: () => false,
  };

  return {
    getClicked: () => clicked,
    page: () => ({
      context: () => ({newCDPSession: async () => client}),
      evaluate: async () => 1,
    }),
    locator: () => ({
      scrollIntoViewIfNeeded: async () => undefined,
      elementHandle: async () => {
        if (options?.noElement) return null;
        return {
          evaluate: async (fn: any, args: any) => {
            const prevWin = (globalThis as any).window;
            const prevDoc = (globalThis as any).document;
            (globalThis as any).window = {innerWidth: 800, innerHeight: 600};
            (globalThis as any).document = {elementFromPoint: () => mockEl};
            try {
              return fn(mockEl, args);
            } finally {
              (globalThis as any).window = prevWin;
              (globalThis as any).document = prevDoc;
            }
          },
        };
      },
      click: async () => {
        clicked = true;
      },
    }),
  };
}

describe('click_at', () => {
  it('clicks at the resolved client rect center for any locator', async () => {
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
      'clientRects',
    );
  });

  it('falls back to locator.click() and reports jsClick when element handle is null', async () => {
    const {calls, client} = makeCdpClient();
    const {response, getContent} = makeResponse();
    const frame = makeFrame(client, {noElement: true});

    await clickAt.handler(
      {params: {selector: '#missing'}} as never,
      response as never,
      {getSelectedFrame: () => frame} as never,
    );

    assert.equal(frame.getClicked(), true);
    assert.equal(calls.length, 0);
    assert.equal(
      (getContent()?.data as Record<string, unknown>)?.source,
      'jsClick',
    );
  });
});
