/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {closePage} from '../../../../src/tools/navigation.js';
import {navigatePage} from '../../../../src/tools/navigation.js';
import {newPage} from '../../../../src/tools/navigation.js';
import {selectPage} from '../../../../src/tools/navigation.js';
import {CLOSE_PAGE_ERROR} from '../../../../src/tools/ToolDefinition.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('navigation tools alignment', () => {
  it('close_page rejects missing pageId and pageIdx', async () => {
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      closePage.handler({params: {}}, response, {} as never),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );
  });

  it('close_page closes via closePageBySelector and falls back to resolvePage+closePage', async () => {
    let closedSelector: unknown;
    const response1 = new ToolResponseAccumulator();
    await closePage.handler({params: {pageId: 'page-2'}}, response1, {
      closePageBySelector: async (selector: unknown) => {
        closedSelector = selector;
      },
    } as never);
    assert.deepEqual(closedSelector, {pageId: 'page-2', pageIdx: undefined});
    assert.equal(
      (
        (response1.toJSON().structuredContent as Record<string, unknown>)
          .data as Record<string, unknown>
      ).closed,
      true,
    );

    let closedIdx: number | undefined;
    const response2 = new ToolResponseAccumulator();
    await closePage.handler({params: {pageIdx: 1}}, response2, {
      resolvePage: () => ({pageIdx: 1, pageId: 'page-1', page: {}}),
      closePage: async (idx: number) => {
        closedIdx = idx;
      },
    } as never);
    assert.equal(closedIdx, 1);
  });

  it('close_page returns structured non-fatal status when last page is protected', async () => {
    const response = new ToolResponseAccumulator();
    await closePage.handler({params: {pageIdx: 0}}, response, {
      closePageBySelector: async () => {
        throw new Error(CLOSE_PAGE_ERROR);
      },
    } as never);
    const data = (
      response.toJSON().structuredContent as Record<string, unknown>
    ).data as Record<string, unknown>;
    assert.equal(data.closed, false);
    assert.equal(data.lastPageProtected, true);
  });

  it('new_page supports background and isolatedContext without selecting background tabs', async () => {
    let selected = false;
    let receivedOptions: unknown;
    const page = {
      addInitScript: async () => undefined,
      goto: async () => undefined,
      url: () => 'https://example.com',
      title: async () => 'Example',
    };
    const response = new ToolResponseAccumulator();
    await newPage.handler(
      {
        params: {
          url: 'https://example.com',
          background: true,
          isolatedContext: 'session-a',
        },
      },
      response,
      {
        newPage: async (options?: unknown) => {
          receivedOptions = options;
          return page;
        },
        selectPage: () => {
          selected = true;
        },
        syncPageContext: () => {
          selected = true;
        },
        getPages: () => [page],
        getPageId: () => 'page-1',
      } as never,
    );
    assert.deepEqual(receivedOptions, {
      background: true,
      isolatedContext: 'session-a',
    });
    assert.equal(selected, false);
  });

  it('select_page does not bringPageToFront by default (aligned with chrome-devtools)', async () => {
    let broughtToFront = false;
    let selected = false;
    let synced = false;
    const page = {url: () => 'https://a.test', title: async () => 'A'};
    const response = new ToolResponseAccumulator();
    await selectPage.handler(
      {params: {pageIdx: 0}},
      response,
      {
        resolvePage: () => ({pageIdx: 0, pageId: 'p0', page}),
        bringPageToFront: async () => {
          broughtToFront = true;
        },
        selectPage: () => {
          selected = true;
        },
        syncPageContext: () => {
          synced = true;
        },
      } as never,
    );
    assert.equal(selected, true);
    assert.equal(synced, true);
    assert.equal(broughtToFront, false);
  });

  it('select_page skips bringPageToFront when bringToFront is false', async () => {
    let broughtToFront = false;
    const page = {url: () => 'https://a.test', title: async () => 'A'};
    const response = new ToolResponseAccumulator();
    await selectPage.handler(
      {params: {pageIdx: 0, bringToFront: false}},
      response,
      {
        resolvePage: () => ({pageIdx: 0, pageId: 'p0', page}),
        bringPageToFront: async () => {
          broughtToFront = true;
        },
        selectPage: () => undefined,
        syncPageContext: () => undefined,
      } as never,
    );
    assert.equal(broughtToFront, false);
  });

  it('select_page calls bringPageToFront when bringToFront is true', async () => {
    const calls: string[] = [];
    const page = {url: () => 'https://a.test', title: async () => 'A'};
    const response = new ToolResponseAccumulator();
    await selectPage.handler(
      {params: {pageIdx: 0, bringToFront: true}},
      response,
      {
        resolvePage: () => ({pageIdx: 0, pageId: 'p0', page}),
        bringPageToFront: async () => {
          calls.push('bringPageToFront');
        },
        selectPage: () => {
          calls.push('selectPage');
        },
        syncPageContext: () => {
          calls.push('syncPageContext');
        },
      } as never,
    );
    assert.deepEqual(calls, [
      'selectPage',
      'syncPageContext',
      'bringPageToFront',
    ]);
  });

  it('navigate_page supports initScript and handleBeforeUnload via waitForEventsAfterAction', async () => {
    let injectedInit: string | undefined;
    let capturedWaitOptions: unknown;
    const page = {
      url: () => 'https://example.test/next',
      addInitScript: async (code: string) => {
        injectedInit = code;
      },
      goto: async () => undefined,
    };
    const response = new ToolResponseAccumulator();
    await navigatePage.handler(
      {
        params: {
          type: 'url',
          url: 'https://example.test/next',
          initScript: 'window.__flag = 1;',
          handleBeforeUnload: 'accept',
        },
      },
      response,
      {
        getPages: () => [page],
        getSelectedPage: () => page,
        getSelectedPageIndex: () => 0,
        getDebuggerContext: async () => ({
          isPaused: () => false,
        }),
        waitForEventsAfterAction: async (
          action: (s: AbortSignal) => Promise<void>,
          options: unknown,
        ) => {
          capturedWaitOptions = options;
          await action(new AbortController().signal);
          return {dialogHandled: true};
        },
      } as never,
    );
    assert.equal(injectedInit, 'window.__flag = 1;');
    assert.deepEqual(capturedWaitOptions, {
      timeout: 10_000,
      handleDialog: 'accept',
    });
    assert.deepEqual(response.getWaitForResult(), {dialogHandled: true});
  });
});
