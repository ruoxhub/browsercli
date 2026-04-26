/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {navigatePage} from '../../../../src/tools/navigation/navigatePage.js';
import type {NavigationRuntimeServices} from '../../../../src/tools/navigation/types.js';
import type {Page} from '../../../../src/third_party/index.js';

interface TestPage {
  goto(url: string, options?: unknown): Promise<void>;
  goBack(options?: unknown): Promise<void>;
  goForward(options?: unknown): Promise<void>;
  reload(options?: unknown): Promise<void>;
  context(): {
    newCDPSession(page: TestPage): Promise<{
      send(method: string, params: unknown): Promise<void>;
    }>;
  };
  url(): string;
}

function createPage(overrides: Partial<TestPage> = {}): TestPage {
  const page: TestPage = {
    goto: async () => undefined,
    goBack: async () => undefined,
    goForward: async () => undefined,
    reload: async () => undefined,
    context: () => ({
      newCDPSession: async () => ({
        send: async () => undefined,
      }),
    }),
    url: () => 'https://example.test',
    ...overrides,
  };

  return page;
}

function createNavigationRuntime(
  overrides: Partial<NavigationRuntimeServices> = {},
): NavigationRuntimeServices {
  return {
    getPages: () => [],
    getPageByIdx: () => {
      throw new Error('unused');
    },
    getSelectedPageIndex: () => null,
    getSelectedPage: () => null,
    newPage: async () => createPage() as unknown as Page,
    selectPage: () => undefined,
    bringPageToFront: async () => undefined,
    ...overrides,
  };
}

describe('navigatePage', () => {
  it('returns actionable message when no active page is selected', async () => {
    const result = await navigatePage(
      createNavigationRuntime(),
      {type: 'reload'},
    );

    assert.equal(result.success, false);
    assert.match(result.message, /new_page/);
    assert.match(result.message, /select_page/);
  });

  it('maps closed-page errors to actionable diagnostics', async () => {
    const page = createPage({
      reload: async () => {
        throw new Error('Target page closed');
      },
    });

    const result = await navigatePage(
      createNavigationRuntime({
        getPages: () => [page as unknown as Page],
        getSelectedPage: () => page as unknown as Page,
      }),
      {type: 'reload'},
    );

    assert.equal(result.success, false);
    assert.match(result.message, /页面已关闭/);
    assert.match(result.message, /list_pages/);
  });

  it('maps timeout errors to readable troubleshooting guidance', async () => {
    const page = createPage({
      goto: async () => {
        throw new Error('Navigation timeout of 10000 ms exceeded');
      },
    });

    const result = await navigatePage(
      createNavigationRuntime({
        getPages: () => [page as unknown as Page],
        getSelectedPage: () => page as unknown as Page,
      }),
      {type: 'url', url: 'https://slow.example'},
    );

    assert.equal(result.success, false);
    assert.match(result.message, /超时/);
    assert.doesNotMatch(
      result.message,
      /Navigation timeout of 10000 ms exceeded/,
    );
  });
});
