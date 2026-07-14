/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  goBack,
  goForward,
  navigate,
  reload,
  waitForNavigation,
  waitForNetworkIdle,
} from '../../../../src/modules/collector/PageNavigation.js';

function makePage(overrides: Record<string, unknown> = {}) {
  const page: Record<string, unknown> = {
    goto: async () => undefined,
    title: async () => 'Example',
    url: () => 'https://example.com',
    reload: async () => undefined,
    goBack: async () => undefined,
    goForward: async () => undefined,
    waitForNavigation: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForURL: async () => undefined,
    ...overrides,
  };
  return page;
}

describe('PageNavigation', () => {
  it('navigate returns url, title, and loadTime', async () => {
    let calledUrl = '';
    let calledOptions: {waitUntil?: string; timeout?: number} | undefined;
    const page = makePage({
      goto: async (
        url: string,
        opts?: {waitUntil?: string; timeout?: number},
      ) => {
        calledUrl = url;
        calledOptions = opts;
      },
    });

    const result = await navigate(page as any, 'https://example.com');

    assert.strictEqual(result.url, 'https://example.com');
    assert.strictEqual(result.title, 'Example');
    assert.ok(result.loadTime >= 0);
    assert.strictEqual(calledUrl, 'https://example.com');
    assert.strictEqual(calledOptions?.waitUntil, 'networkidle');
  });

  it('navigate forwards options', async () => {
    let calledOptions: {waitUntil?: string; timeout?: number} | undefined;
    const page = makePage({
      goto: async (
        _url: string,
        opts?: {waitUntil?: string; timeout?: number},
      ) => {
        calledOptions = opts;
      },
    });

    await navigate(page as any, 'https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: 5000,
    });

    assert.strictEqual(calledOptions?.waitUntil, 'domcontentloaded');
    assert.strictEqual(calledOptions?.timeout, 5000);
  });

  it('reload forwards options', async () => {
    let calledOptions: {waitUntil?: string; timeout?: number} | undefined;
    const page = makePage({
      reload: async (opts?: {waitUntil?: string; timeout?: number}) => {
        calledOptions = opts;
      },
    });

    await reload(page as any, {waitUntil: 'load', timeout: 10000});

    assert.strictEqual(calledOptions?.waitUntil, 'load');
    assert.strictEqual(calledOptions?.timeout, 10000);
  });

  it('goBack and goForward call page methods', async () => {
    let backCalled = false;
    let forwardCalled = false;
    const page = makePage({
      goBack: async () => {
        backCalled = true;
      },
      goForward: async () => {
        forwardCalled = true;
      },
    });

    await goBack(page as any);
    await goForward(page as any);

    assert.ok(backCalled, 'goBack was called');
    assert.ok(forwardCalled, 'goForward was called');
  });

  it('waitForNavigation and waitForNetworkIdle forward timeout', async () => {
    let navTimeout: number | undefined;
    let urlArg: string | undefined;
    let urlOpts: {waitUntil?: string; timeout?: number} | undefined;
    const page = makePage({
      waitForNavigation: async (opts?: {timeout?: number}) => {
        navTimeout = opts?.timeout;
      },
      waitForURL: async (
        url: string,
        opts?: {waitUntil?: string; timeout?: number},
      ) => {
        urlArg = url;
        urlOpts = opts;
      },
    });

    await waitForNavigation(page as any, 7000);
    await waitForNetworkIdle(page as any, 9000);

    assert.strictEqual(navTimeout, 7000);
    assert.strictEqual(urlArg, '**');
    assert.strictEqual(urlOpts?.waitUntil, 'networkidle');
    assert.strictEqual(urlOpts?.timeout, 9000);
  });
});
