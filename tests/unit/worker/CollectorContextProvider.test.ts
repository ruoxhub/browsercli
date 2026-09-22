/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {BrowserContext} from 'patchright';

import {CollectorContextProvider} from '../../../src/worker/context/CollectorContextProvider.js';

describe('CollectorContextProvider', () => {
  it('collects and queries network requests and console messages', () => {
    const provider = new CollectorContextProvider();
    const mockPage = {id: 'page-1'};
    const request1 = {url: () => 'https://a.com'};

    provider.networkCollector.seedPageData(mockPage as never, [
      [{stableId: 10, request: request1 as never}],
    ]);

    const reqs = provider.getNetworkRequests(mockPage as never, false);
    assert.deepStrictEqual(reqs, [request1]);

    const stableId = provider.getNetworkRequestStableId(
      [mockPage as never],
      request1,
    );
    assert.strictEqual(stableId, 10);

    const found = provider.getNetworkRequestById([mockPage as never], 10);
    assert.strictEqual(found, request1);
  });

  it('continues collecting requests after clearNetworkRequests', () => {
    const provider = new CollectorContextProvider();
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const mockPage = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      },
      once: () => undefined,
      off: () => undefined,
      mainFrame: () => ({}),
      context: () => ({
        newCDPSession: async () => ({
          on: () => undefined,
          off: () => undefined,
          send: async () => undefined,
          detach: async () => undefined,
        }),
      }),
    };
    const request = {
      url: () => 'https://example.com/api',
      method: () => 'GET',
      frame: () => ({}),
      resourceType: () => 'fetch',
    };

    provider.attachPage(mockPage as never);
    provider.clearNetworkRequests(mockPage as never);
    handlers.get('request')?.(request);

    assert.deepStrictEqual(
      provider.getNetworkRequests(mockPage as never, false),
      [request],
    );
    assert.strictEqual(
      provider.getNetworkRequestStableId([mockPage as never], request),
      1,
    );
  });

  it('starts and disposes against a browser context', () => {
    const provider = new CollectorContextProvider();
    const context = {
      on: () => context,
      off: () => context,
      pages: () => [],
    } as unknown as BrowserContext;

    assert.doesNotThrow(() => provider.start(context));
    assert.ok(provider.isStarted());
    assert.doesNotThrow(() => provider.dispose());
    assert.strictEqual(provider.isStarted(), false);
  });
});
