/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {BrowserContextProvider} from '../../../src/worker/context/BrowserContextProvider.js';

function createPage(name: string) {
  let closed = false;
  const page = {
    name,
    isClosed: () => closed,
    mainFrame: () => null,
    on: () => undefined,
    off: () => undefined,
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
  };
  return {
    page,
    close: () => {
      closed = true;
    },
  };
}

describe('BrowserContextProvider', () => {
  it('updates timeouts based on CPU and network throttling', () => {
    const provider = new BrowserContextProvider();
    let timeoutVal = 0;
    let navTimeoutVal = 0;
    const mockPage = {
      isClosed: () => false,
      mainFrame: () => null,
      setDefaultTimeout: (val: number) => {
        timeoutVal = val;
      },
      setDefaultNavigationTimeout: (val: number) => {
        navTimeoutVal = val;
      },
      on: () => undefined,
    };

    provider.setSelectedPage(mockPage as never);
    provider.selectPage(mockPage as never);

    provider.setCpuThrottlingRate(2);
    assert.strictEqual(timeoutVal, 10000); // 5000 * 2

    provider.setNetworkConditions('Slow 4G');
    assert.strictEqual(navTimeoutVal, 25000); // 10000 * 2.5
  });

  it('selects frame by index correctly', () => {
    const provider = new BrowserContextProvider();
    const frame0 = {name: 'main'};
    const frame1 = {name: 'iframe'};
    const mockPage = {
      isClosed: () => false,
      mainFrame: () => null,
      frames: () => [frame0, frame1],
      on: () => undefined,
      setDefaultTimeout: () => undefined,
      setDefaultNavigationTimeout: () => undefined,
    };

    provider.setSelectedPage(mockPage as never);
    const selected = provider.selectFrameByIdx(1);
    assert.strictEqual(selected, frame1);
    assert.strictEqual(provider.getSelectedFrame(), frame1);
  });

  it('keeps page IDs stable across reconciliation and reordering', () => {
    const provider = new BrowserContextProvider();
    const first = createPage('first');
    const second = createPage('second');

    provider.setPages([first.page, second.page] as never[]);
    const firstId = provider.getPageId(first.page as never);
    const secondId = provider.getPageId(second.page as never);

    provider.setPages([second.page, first.page] as never[]);

    assert.equal(provider.getPageId(first.page as never), firstId);
    assert.equal(provider.getPageId(second.page as never), secondId);
    assert.deepStrictEqual([firstId, secondId], ['page-1', 'page-2']);
  });

  it('invalidates a closed page ID and never reuses it', () => {
    const provider = new BrowserContextProvider();
    const first = createPage('first');
    provider.setPages([first.page] as never[]);
    const retiredId = provider.getPageId(first.page as never);

    first.close();
    provider.setPages([]);
    assert.throws(
      () => provider.resolvePage({pageId: retiredId}),
      /已失效.*list_pages/,
    );

    const replacement = createPage('replacement');
    provider.setPages([replacement.page] as never[]);
    assert.equal(provider.getPageId(replacement.page as never), 'page-2');
  });

  it('invalidates old IDs when switching or clearing BrowserContext', () => {
    const provider = new BrowserContextProvider();
    const first = createPage('first');
    const second = createPage('second');
    const firstContext = {pages: () => [first.page]};
    const secondContext = {pages: () => [second.page]};

    provider.setContext(firstContext as never);
    const firstId = provider.getPageId(first.page as never);
    provider.setContext(secondContext as never);

    assert.throws(() => provider.resolvePage({pageId: firstId}), /已失效/);
    assert.equal(provider.getPageId(second.page as never), 'page-2');

    provider.clearContext();
    assert.deepStrictEqual(provider.getPages(), []);
    assert.equal(provider.getSelectedPage(), null);
    assert.throws(() => provider.resolvePage({pageId: 'page-2'}), /已失效/);
  });

  it('invalidates IDs on dispose without resetting the counter', () => {
    const provider = new BrowserContextProvider();
    const first = createPage('first');
    provider.setPages([first.page] as never[]);
    const firstId = provider.getPageId(first.page as never);

    provider.dispose();
    assert.throws(() => provider.resolvePage({pageId: firstId}), /已失效/);

    const second = createPage('second');
    provider.setPages([second.page] as never[]);
    assert.equal(provider.getPageId(second.page as never), 'page-2');
  });

  it('resolves page selectors and rejects conflicting identities', () => {
    const provider = new BrowserContextProvider();
    const first = createPage('first');
    const second = createPage('second');
    provider.setPages([first.page, second.page] as never[]);
    provider.setSelectedPage(second.page as never);
    const firstId = provider.getPageId(first.page as never);
    const secondId = provider.getPageId(second.page as never);

    assert.equal(provider.resolvePage({pageId: firstId}).page, first.page);
    assert.equal(provider.resolvePage({pageIdx: 1}).pageId, secondId);
    assert.equal(
      provider.resolvePage({pageId: secondId, pageIdx: 1}).page,
      second.page,
    );
    assert.throws(
      () => provider.resolvePage({pageId: firstId, pageIdx: 1}),
      new RegExp(`pageId ${firstId}.*pageIdx 1`),
    );
    assert.throws(
      () => provider.resolvePage({pageId: 'page-999'}),
      /未知页面 ID.*list_pages/,
    );
    assert.throws(() => provider.resolvePage({pageIdx: -1}), /非负整数/);
    assert.throws(() => provider.resolvePage({pageIdx: 0.5}), /非负整数/);
    assert.throws(() => provider.resolvePage({pageIdx: 2}), /超出范围/);
    assert.throws(() => provider.resolvePage({}), /未提供 pageId 或 pageIdx/);
    assert.equal(
      provider.resolvePage({fallbackToSelected: true}).page,
      second.page,
    );
  });

  it('does not fall back to a stale selected page', () => {
    const provider = new BrowserContextProvider();
    const stale = createPage('stale');
    provider.setPages([stale.page] as never[]);
    provider.setSelectedPage(stale.page as never);
    stale.close();
    provider.setPages([]);

    assert.throws(
      () => provider.resolvePage({fallbackToSelected: true}),
      /当前没有选中的页面/,
    );
  });

  it('cleans up state when browser emits disconnected event', () => {
    const provider = new BrowserContextProvider();
    let disconnectedListener: (() => void) | undefined;
    const mockBrowser = {
      isConnected: () => true,
      once: (event: string, cb: () => void) => {
        if (event === 'disconnected') disconnectedListener = cb;
      },
    };
    const mockContext = {pages: () => []};

    provider.setBrowser(mockBrowser as never);
    provider.setContext(mockContext as never);
    assert.strictEqual(provider.isBrowserConnected(), true);

    disconnectedListener?.();
    assert.strictEqual(provider.isBrowserConnected(), false);
    assert.strictEqual(provider.getBrowser(), null);
    assert.strictEqual(provider.getContext(), null);
  });

  it('syncs with browserManager when local browser is disconnected', () => {
    const provider = new BrowserContextProvider();
    let managerConnected = false;
    const fakeManagerBrowser = {
      isConnected: () => managerConnected,
      contexts: () => [{pages: () => []}],
    };
    const mockManager = {
      isConnected: () => managerConnected,
      getBrowser: () => (managerConnected ? fakeManagerBrowser : null),
      getContext: () =>
        managerConnected ? fakeManagerBrowser.contexts()[0] : null,
    };

    provider.setBrowserManager(mockManager as never);
    assert.strictEqual(provider.isBrowserConnected(), false);

    managerConnected = true;
    assert.strictEqual(provider.isBrowserConnected(), true);
    assert.strictEqual(provider.getBrowser(), fakeManagerBrowser);
    assert.ok(provider.getContext());
  });

  it('recovers connection via ensureConnectedBrowser', async () => {
    const provider = new BrowserContextProvider();
    const fakePage = createPage('restored');
    const fakeContext = {pages: () => [fakePage.page]};
    const fakeBrowser = {
      isConnected: () => true,
      contexts: () => [fakeContext],
      once: () => undefined,
    };
    let ensureCalled = false;
    const mockManager = {
      isConnected: () => false,
      ensureBrowser: async () => {
        ensureCalled = true;
        return fakeBrowser;
      },
      getContext: () => fakeContext,
    };

    provider.setBrowserManager(mockManager as never);
    assert.strictEqual(provider.isBrowserConnected(), false);

    const recovered = await provider.ensureConnectedBrowser();
    assert.strictEqual(ensureCalled, true);
    assert.strictEqual(recovered, fakeBrowser);
    assert.strictEqual(provider.isBrowserConnected(), true);
    assert.strictEqual(provider.getPages().length, 1);
  });
});
