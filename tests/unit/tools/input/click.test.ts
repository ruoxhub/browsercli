/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {describe, it} from 'node:test';

import {WaitForHelper} from '../../../../src/modules/browser/WaitForHelper.js';
import {handleDialog} from '../../../../src/tools/dialog.js';
import {click} from '../../../../src/tools/input.js';
import {ToolError} from '../../../../src/utils/errors.js';
import {ConcurrencyQueue} from '../../../../src/worker/ToolExecutor.js';

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
      locator: (selector: string) => ({
        click: async (options: unknown) => {
          calls.push({selector, options});
        },
      }),
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
      locator: () => ({
        click: async () => await new Promise<never>(() => undefined),
      }),
    };
    const output = captureResponse();

    await assert.rejects(
      () =>
        click.handler(
          {params: {selector: '#submit', timeoutMs: 10}} as never,
          output.response as never,
          {getSelectedFrame: () => frame} as never,
        ),
      (error: unknown) =>
        error instanceof ToolError && /超时 \(10ms\)/.test(error.message),
    );
  });

  it('returns promptly when click triggers an unhandled alert dialog instead of hanging', async () => {
    const emitter = new EventEmitter();
    const fakePage = {
      url: () => 'https://example.test/',
      on: (event: string, listener: (...args: unknown[]) => void) =>
        emitter.on(event, listener),
      off: (event: string, listener: (...args: unknown[]) => void) =>
        emitter.off(event, listener),
      context: () => ({
        newCDPSession: async () => ({
          on: () => undefined,
          off: () => undefined,
          send: async () => undefined,
          // Simulate a CDP detach that hangs while a JS dialog pauses the renderer
          detach: async () => await new Promise<never>(() => undefined),
        }),
      }),
    };

    const helper = new WaitForHelper(fakePage as never);
    const t0 = Date.now();
    const waitResult = await helper.waitForEventsAfterAction(
      async () => {
        setTimeout(() => {
          emitter.emit('dialog', {
            type: () => 'alert',
            message: () => 'hello alert',
          });
        }, 20);
        // Simulate Patchright locator.click blocking until dialog is handled
        await new Promise<never>(() => undefined);
      },
      {timeout: 5000},
    );

    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1500, `expected fast return, got ${elapsed}ms`);
    assert.deepEqual(waitResult.dialogOpened, {
      type: 'alert',
      message: 'hello alert',
    });
  });

  it('keeps handle_dialog unlocked (concurrency=none) and releases ConcurrencyQueue on abort', async () => {
    assert.equal(handleDialog.concurrency, 'none');

    const queue = new ConcurrencyQueue();
    const controller = new AbortController();
    const stuck = queue.run(
      'page',
      'page-1',
      async () => await new Promise<never>(() => undefined),
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error('cancelled')), 15);
    await assert.rejects(stuck, /cancelled/);

    // Subsequent task on the same page must not deadlock
    const next = await queue.run('page', 'page-1', async () => 'recovered');
    assert.equal(next, 'recovered');
  });
});
