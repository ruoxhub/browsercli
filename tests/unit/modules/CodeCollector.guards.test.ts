/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {CodeCollector} from '../../../src/modules/collector/CodeCollector.js';

function buildStubCollector() {
  const stubBrowserManager = {
    launch: async () => null,
    newPage: async () => null,
    getCurrentPage: () => null,
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setCurrentPage: () => {},
  } as any;
  return new CodeCollector(
    {timeout: 5000, maxCollectedUrls: 100} as any,
    stubBrowserManager,
  );
}

describe('CodeCollector defensive guards', () => {
  it('uses an external page without launching an internal browser', async () => {
    let launches = 0;
    const browserManager = {
      launch: async () => {
        launches += 1;
        return null;
      },
      newPage: async () => null,
      getCurrentPage: () => null,
      setCurrentPage: () => undefined,
    } as any;
    const collector = new CodeCollector(
      {timeout: 5000, maxCollectedUrls: 100} as any,
      browserManager,
    );
    const page = {isClosed: () => false};
    collector.setPageResolver(() => page as never);

    assert.equal(await collector.getActivePage(), page);
    assert.equal(launches, 0);
  });

  it('collect() returns NO_PAGE_CONTEXT when pageResolver is unset', async () => {
    const collector = buildStubCollector();
    const result = await collector.collect({url: 'https://example.com'});
    assert.equal((result as any).error, 'NO_PAGE_CONTEXT');
    assert.equal(result.files.length, 0);
    assert.match((result as any).message, /select_page|new_page/);
  });

  it('collect() returns NO_PAGE_CONTEXT when pageResolver returns null', async () => {
    const collector = buildStubCollector();
    collector.setPageResolver(() => null);
    const result = await collector.collect({url: 'https://example.com'});
    assert.equal((result as any).error, 'NO_PAGE_CONTEXT');
  });

  it('getFilesByPattern() returns empty result with warning when cache is empty', () => {
    const collector = buildStubCollector();
    const result = collector.getFilesByPattern('.*');
    assert.equal(result.files.length, 0);
    assert.equal(result.matched, 0);
    assert.ok((result as any).warning);
  });

  it('getFilesByPattern() returns INVALID_PATTERN for bad regex', () => {
    const collector = buildStubCollector();
    // Pre-populate cache so we pass the empty-cache guard
    (collector as any).collectedFilesCache.set('test', {
      url: 'test.js',
      content: 'x',
      size: 1,
      type: 'inline',
    });
    const result = collector.getFilesByPattern('[invalid');
    assert.equal((result as any).error, 'INVALID_PATTERN');
    assert.equal(result.files.length, 0);
  });
});
