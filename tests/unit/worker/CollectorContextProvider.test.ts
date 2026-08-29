/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {BrowserContext, Page, Response} from 'patchright';

import {DatabaseManager} from '../../../src/database/DatabaseManager.js';
import {CaptureEngine} from '../../../src/modules/session/CaptureEngine.js';
import {CaptureSessionManager} from '../../../src/modules/session/CaptureSessionManager.js';
import {SqliteSessionStore} from '../../../src/modules/session/SqliteSessionStore.js';
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

  it('ingests CDP responses through the capture bridge when an engine is provided', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const listeners = new Set<(response: Response) => void>();
    const context = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') listeners.add(handler);
        return context;
      },
      off: (_event: string, handler: (response: Response) => void) => {
        listeners.delete(handler);
        return context;
      },
      pages: () => [],
    } as unknown as BrowserContext;

    const provider = new CollectorContextProvider(() => engine);
    provider.start(context);
    assert.ok(provider.isStarted());

    // url() 是 patchright Response 契约的一部分：readCdpResponseBody() 在任何
    // await 之前就用它拼超时消息（CdpRequestAdapter.ts:43），缺失会在取体时抛
    // TypeError 并被降级成「无 body」——断言仍能过，但走的是降级路径。
    const response = {
      status: () => 200,
      headers: () => ({'content-type': 'text/plain'}),
      url: () => 'https://b.dev/probe',
      request: () => ({
        method: () => 'GET',
        url: () => 'https://b.dev/probe',
        headers: () => ({}),
        postData: () => null,
      }),
      text: async () => 'pong',
    } as unknown as Response;
    for (const listener of [...listeners]) listener(response);
    await new Promise(resolve => setImmediate(resolve));

    const session = manager.getActiveSession();
    assert.ok(session);
    const rows = manager.getRequests(session.id);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(
      rows[0]!.responseBody,
      'pong',
      '正常取体路径（非降级）必须把 body 落库',
    );

    provider.dispose();
    assert.strictEqual(listeners.size, 0, 'dispose 必须解挂 response 监听');
    db.close();
  });

  it('starts without an engine and stays silent on responses', () => {
    const provider = new CollectorContextProvider();
    const context = {
      on: () => context,
      off: () => context,
      pages: () => [],
    } as unknown as BrowserContext;

    assert.doesNotThrow(() => provider.start(context));
    assert.ok(provider.isStarted());
    assert.doesNotThrow(() => provider.dispose());
  });

  it('filters CDP responses by selected page when a guard is provided', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);

    const selected = {id: 'page-sel'} as unknown as Page;
    const listeners = new Set<(response: Response) => void>();
    const context = {
      on: (event: string, handler: (response: Response) => void) => {
        if (event === 'response') listeners.add(handler);
        return context;
      },
      off: (_event: string, handler: (response: Response) => void) => {
        listeners.delete(handler);
        return context;
      },
      pages: () => [],
    } as unknown as BrowserContext;

    const provider = new CollectorContextProvider(
      () => engine,
      p => p === selected,
    );
    provider.start(context);

    const response = {
      status: () => 200,
      headers: () => ({'content-type': 'text/plain'}),
      url: () => 'https://b.dev/probe',
      frame: () => ({page: () => ({id: 'page-other'})}),
      request: () => ({
        method: () => 'GET',
        url: () => 'https://b.dev/probe',
        headers: () => ({}),
        postData: () => null,
      }),
      text: async () => 'pong',
    } as unknown as Response;
    for (const listener of [...listeners]) listener(response);
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(manager.getActiveSession(), null, '非选中页不建会话');
    provider.dispose();
    assert.strictEqual(listeners.size, 0, 'dispose 必须解挂 response 监听');
    db.close();
  });
});
