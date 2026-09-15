/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {resolveClickPoint} from '../../../../src/modules/browser/clickPoint.js';

interface MockFrameOptions {
  scrollFails?: boolean;
  noElement?: boolean;
  rects?: Array<{
    left: number;
    top: number;
    right?: number;
    bottom?: number;
    width: number;
    height: number;
  }>;
  boundingRect?: {x: number; y: number; width: number; height: number};
  elementFromPoint?: (x: number, y: number) => unknown;
}

function makeMockFrame(options?: MockFrameOptions) {
  let scrolled = false;
  const mockEl = {
    getClientRects: () => options?.rects ?? [],
    getBoundingClientRect: () =>
      options?.boundingRect ?? {x: 10, y: 20, width: 100, height: 40},
    contains: (_other: unknown) => false,
  };

  return {
    getScrolled: () => scrolled,
    page: () => ({
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
          evaluate: async (fn: any, args: any) => {
            const prevWin = (globalThis as any).window;
            const prevDoc = (globalThis as any).document;
            (globalThis as any).window = {
              innerWidth: 800,
              innerHeight: 600,
            };
            (globalThis as any).document = {
              elementFromPoint: (x: number, y: number) => {
                if (options?.elementFromPoint) {
                  return options.elementFromPoint(x, y);
                }
                return mockEl;
              },
            };
            try {
              return fn(mockEl, args);
            } finally {
              (globalThis as any).window = prevWin;
              (globalThis as any).document = prevDoc;
            }
          },
        };
      },
    }),
  };
}

describe('resolveClickPoint', () => {
  it('scrolls into view and picks largest visible rect for any locator', async () => {
    const frame = makeMockFrame({
      rects: [
        {left: 900, top: 900, right: 920, bottom: 920, width: 20, height: 20},
        {left: -10, top: 10, right: 90, bottom: 50, width: 100, height: 40},
      ],
    });

    const result = await resolveClickPoint(
      frame as never,
      'role=button[name="提交"]',
    );

    assert.equal(frame.getScrolled(), true);
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'clientRects');
    assert.equal(result.quadCount, 2);
    assert.equal(result.x, 40);
    assert.equal(result.y, 30);
  });

  it('selects alternative rect when the primary rect is obscured by another element', async () => {
    const frame = makeMockFrame({
      rects: [
        {left: 10, top: 10, right: 50, bottom: 50, width: 40, height: 40},
        {left: 60, top: 10, right: 90, bottom: 40, width: 30, height: 30},
      ],
      elementFromPoint: (x, y) => {
        if (x === 30 && y === 30) return {id: 'overlay'};
        return null;
      },
    });

    const result = await resolveClickPoint(frame as never, '#btn');
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'clientRects');
    assert.equal(result.quadCount, 2);
    assert.equal(result.x, 75);
    assert.equal(result.y, 25);
  });

  it('returns largest candidate even when all candidates are obscured', async () => {
    const frame = makeMockFrame({
      rects: [
        {left: 10, top: 10, right: 50, bottom: 50, width: 40, height: 40},
        {left: 60, top: 10, right: 90, bottom: 40, width: 30, height: 30},
      ],
      elementFromPoint: () => ({id: 'full-overlay'}),
    });

    const result = await resolveClickPoint(frame as never, '#btn');
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'clientRects');
    assert.equal(result.x, 30);
    assert.equal(result.y, 30);
  });

  it('falls back to getBoundingClientRect when client rects are empty', async () => {
    const frame = makeMockFrame({
      rects: [],
      boundingRect: {x: 100, y: 200, width: 50, height: 20},
    });

    const result = await resolveClickPoint(frame as never, '#btn');
    assert.equal(result.kind, 'point');
    if (result.kind !== 'point') return;
    assert.equal(result.source, 'boundingRect');
    assert.equal(result.quadCount, 0);
    assert.equal(result.x, 125);
    assert.equal(result.y, 210);
  });

  it('reports jsClick when locator cannot find element handle', async () => {
    const frame = makeMockFrame({noElement: true});

    const result = await resolveClickPoint(frame as never, '#missing');
    assert.deepEqual(result, {kind: 'jsClick'});
  });
});
