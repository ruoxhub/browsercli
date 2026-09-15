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
): {
  calls: SendCall[];
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
} {
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

function makeMockFrame(
  client: unknown,
  options?: {
    scrollFails?: boolean;
    boundingBox?: {x: number; y: number; width: number; height: number};
    noElement?: boolean;
  },
) {
  let scrolled = false;
  return {
    getScrolled: () => scrolled,
    page: () => ({
      context: () => ({newCDPSession: async () => client}),
      evaluate: async () => 1,
    }),
    locator: (_selector: string) => ({
      scrollIntoViewIfNeeded: async () => {
        if (options?.scrollFails) throw new Error('scroll failed');
        scrolled = true;
      },
      elementHandle: async () => {
        if (options?.noElement) return null;
        return {
          _remoteObject: () => ({objectId: 'remote-obj-1'}),
          evaluate: async (_fn: (el: unknown) => unknown) => {
            const rect = options?.boundingBox ?? {
              x: 10,
              y: 20,
              width: 100,
              height: 40,
            };
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
      'Page.getLayoutMetrics': () => ({
        cssLayoutViewport: {clientWidth: 800, clientHeight: 600},
      }),
      'DOM.getContentQuads': () => ({
        quads: [
          [900, 900, 920, 900, 920, 920, 900, 920],
          [-10, 10, 90, 10, 90, 50, -10, 50],
        ],
      }),
    });
    const frame = makeMockFrame(client);

    const result = await resolveClickPoint(
      frame as never,
      'role=button[name="提交"]',
    );

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
      'Page.getLayoutMetrics': () => ({
        cssLayoutViewport: {clientWidth: 800, clientHeight: 600},
      }),
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
      'Page.getLayoutMetrics': () => ({
        cssLayoutViewport: {clientWidth: 800, clientHeight: 600},
      }),
      'DOM.getContentQuads': () => ({quads: []}),
      'DOM.getBoxModel': () => {
        throw new Error('no box model');
      },
    });
    const frame = makeMockFrame(client, {
      boundingBox: {x: 100, y: 200, width: 50, height: 20},
    });

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
