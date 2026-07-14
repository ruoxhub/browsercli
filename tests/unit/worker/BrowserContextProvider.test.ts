/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {BrowserContextProvider} from '../../../src/worker/context/BrowserContextProvider.js';

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
});
