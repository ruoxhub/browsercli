/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';
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

    const stableId = provider.getNetworkRequestStableId([mockPage as never], request1);
    assert.strictEqual(stableId, 10);

    const found = provider.getNetworkRequestById([mockPage as never], 10);
    assert.strictEqual(found, request1);
  });
});
