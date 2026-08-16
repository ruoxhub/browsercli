/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {click} from '../../../../src/tools/input/click.js';

function captureResponse() {
  let content: Record<string, unknown> | undefined;
  return {
    response: {
      setStructuredContent(value: Record<string, unknown>) {
        content = value;
      },
    },
    get content() {
      return content;
    },
  };
}

describe('click', () => {
  it('clicks through the selected frame with the requested timeout', async () => {
    const calls: unknown[] = [];
    const frame = {
      click: async (selector: string, options: unknown) => {
        calls.push({selector, options});
      },
      page: () => {
        throw new Error('page() must not be used');
      },
    };
    const output = captureResponse();

    await click.handler(
      {
        params: {selector: '#submit', dblClick: true, timeoutMs: 27},
      } as never,
      output.response as never,
      {getSelectedFrame: () => frame} as never,
    );

    assert.deepEqual(calls, [
      {
        selector: '#submit',
        options: {clickCount: 2, timeout: 27},
      },
    ]);
    assert.equal(output.content?.success, true);
  });

  it('returns after the outer deadline when the frame stays blocked', async () => {
    const frame = {
      click: async () => await new Promise<never>(() => undefined),
    };
    const output = captureResponse();

    await click.handler(
      {params: {selector: '#submit', timeoutMs: 10}} as never,
      output.response as never,
      {getSelectedFrame: () => frame} as never,
    );

    assert.equal(output.content?.success, false);
    assert.match(String(output.content?.message), /超时 \(10ms\)/);
  });
});
