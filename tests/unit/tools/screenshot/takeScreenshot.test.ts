/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {takeScreenshot} from '../../../../src/tools/screenshot/takeScreenshot.js';
import {ToolError} from '../../../../src/utils/errors.js';

function captureResponse() {
  let content: Record<string, unknown> | undefined;
  return {
    response: {
      setStructuredContent(value: Record<string, unknown>) {
        content = value;
      },
      attachImage(value: unknown) {
        void value;
      },
    },
    get content() {
      return content;
    },
  };
}

describe('take_screenshot', () => {
  it('forwards a configurable deadline to the page screenshot', async () => {
    const calls: unknown[] = [];
    const page = {
      screenshot: async (options: unknown) => {
        calls.push(options);
        return Buffer.from('image');
      },
    };
    const output = captureResponse();

    await takeScreenshot.handler(
      {params: {format: 'png', timeoutMs: 37}} as never,
      output.response as never,
      {getSelectedPage: () => page} as never,
    );

    assert.equal((calls[0] as {timeout?: number}).timeout, 37);
    assert.equal(output.content?.success, true);
  });

  it('returns a structured timeout when rendering stays blocked', async () => {
    const page = {
      screenshot: async () => await new Promise<never>(() => undefined),
    };
    const output = captureResponse();

    await assert.rejects(
      () =>
        takeScreenshot.handler(
          {params: {format: 'png', timeoutMs: 10}} as never,
          output.response as never,
          {getSelectedPage: () => page} as never,
        ),
      (error: unknown) =>
        error instanceof ToolError && /超时 \(10ms\)/.test(error.message),
    );
  });
});
