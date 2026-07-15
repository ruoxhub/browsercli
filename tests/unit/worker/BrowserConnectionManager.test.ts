/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it, mock} from 'node:test';

import {
  connectBrowser,
  disconnectBrowser,
} from '../../../src/worker/BrowserConnectionManager.js';
import {BrowserManager} from '../../../src/modules/browser/index.js';

describe('BrowserConnectionManager', () => {
  it('connectBrowser resets old instance, creates new, binds to contextProvider', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(),
    );
    const fakeBrowser = {
      contexts: () => [{pages: () => []}],
      isConnected: () => true,
      version: () => 'test',
    };
    const fakeManager = {
      ensureBrowser: () => Promise.resolve(fakeBrowser),
      getContext: () => fakeBrowser.contexts()[0],
      getBrowser: () => fakeBrowser,
      isConnected: () => true,
    };
    const getInstanceMock = mock.method(
      BrowserManager,
      'getInstance',
      () => fakeManager,
    );

    const setBrowserManager = mock.fn();
    const setBrowser = mock.fn();
    const setContext = mock.fn();
    const init = mock.fn(() => Promise.resolve());
    const contextProvider = {setBrowserManager, setBrowser, setContext, init};

    const config = {headless: true, isolated: true};
    const result = await connectBrowser(
      contextProvider as never,
      config as never,
    );

    assert.strictEqual(resetMock.mock.callCount(), 1);
    assert.strictEqual(getInstanceMock.mock.callCount(), 1);
    assert.strictEqual(setBrowserManager.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.callCount(), 1);
    assert.strictEqual(setContext.mock.callCount(), 1);
    assert.strictEqual(init.mock.callCount(), 1);
    assert.ok(result.mode);

    resetMock.mock.restore();
    getInstanceMock.mock.restore();
  });

  it('disconnectBrowser resets instance and clears contextProvider browser', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(),
    );

    const setBrowser = mock.fn();
    const contextProvider = {setBrowser};

    await disconnectBrowser(contextProvider as never);

    assert.strictEqual(resetMock.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.calls[0].arguments[0], null);

    resetMock.mock.restore();
  });
});
