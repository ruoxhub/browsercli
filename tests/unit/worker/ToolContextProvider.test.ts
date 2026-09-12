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
import type {Runtime} from '../../../src/runtime.js';
import {understandCode} from '../../../src/tools/analyzer/understand.js';
import {ToolContextProvider} from '../../../src/worker/ToolContext.js';
import {ToolResponseAccumulator} from '../../../src/worker/ToolResponse.js';

describe('ToolContextProvider', () => {
  it('provides analyzer runtime services for understand_code', async () => {
    const response = new ToolResponseAccumulator();
    await understandCode.handler(
      {
        params: {
          code: 'console.log("hello world");',
          focus: 'structure',
          useAI: false,
        },
      },
      response,
      {} as never,
    );

    const result = response.toJSON().structuredContent as {
      success: boolean;
      tooltype: string;
      message: string;
      data: unknown;
    };
    assert.equal(result.success, true);
    assert.equal(result.tooltype, 'understand');
    assert.match(result.message, /completed/i);
    assert.ok(result.data !== null && result.data !== undefined);
  });

  it('reuses debugger context for the same page', async () => {
    const runtime = new ToolContextProvider();
    const client = {
      on: () => undefined,
      off: () => undefined,
      send: async () => undefined,
      detach: async () => undefined,
    };
    const page = {
      isClosed: () => false,
      mainFrame: () => null,
      context: () => ({
        newCDPSession: async () => client,
      }),
      once: () => undefined,
    };

    runtime.setSelectedPage(page as never);

    const first = await runtime.getDebuggerContext();
    const second = await runtime.getDebuggerContext();

    assert.equal(first, second);
  });

  it('resets the selected frame to the new page main frame when switching pages', () => {
    const runtime = new ToolContextProvider();
    const oldFrame = {name: 'old-frame'};
    const newFrame = {name: 'new-main-frame'};
    const newPage = {
      mainFrame: () => newFrame,
      on: () => undefined,
      once: () => undefined,
      setDefaultTimeout: () => undefined,
      setDefaultNavigationTimeout: () => undefined,
    };

    runtime.setSelectedFrame(oldFrame as never);
    runtime.selectPage(newPage as never);
    assert.equal(runtime.getSelectedFrame(), newFrame);

    runtime.setSelectedFrame(oldFrame as never);
    runtime.syncPageContext(newPage as never);
    assert.equal(runtime.getSelectedFrame(), newFrame);
  });

  it('keeps the debugger disabled when selecting pages and frames', () => {
    const runtime = new ToolContextProvider();
    let debuggerWarmups = 0;
    const debuggerContext = (
      runtime as unknown as {
        _debuggerContext: {ensureForPage: () => Promise<unknown>};
      }
    )._debuggerContext;
    debuggerContext.ensureForPage = async () => {
      debuggerWarmups += 1;
    };

    const frame = {name: 'main-frame'};
    const page = {
      frames: () => [frame],
      mainFrame: () => frame,
      on: () => undefined,
      once: () => undefined,
      setDefaultTimeout: () => undefined,
      setDefaultNavigationTimeout: () => undefined,
    };

    runtime.selectPage(page as never);
    runtime.selectFrameByIdx(0);

    assert.equal(debuggerWarmups, 0);
  });

  it('reads network requests from the requested page index', () => {
    const runtime = new ToolContextProvider();
    const selectedPage = {
      id: 'selected',
      isClosed: () => false,
      mainFrame: () => null,
      url: () => 'selected',
      on: () => undefined,
    };
    const targetPage = {
      id: 'target',
      isClosed: () => false,
      mainFrame: () => null,
      url: () => 'target',
      on: () => undefined,
    };
    const selectedRequest = {url: () => 'https://example.test/selected'};
    const targetRequest = {url: () => 'https://example.test/target'};

    runtime.setPages([selectedPage as never, targetPage as never]);
    runtime.setSelectedPage(selectedPage as never);

    // 通过 NetworkRequestCollector 的测试 seed 接口写入数据，
    // 避免依赖 ToolContextProvider 的内部 WeakMap 字段。
    runtime.networkCollector.seedPageData(selectedPage as never, [
      [{stableId: 1, request: selectedRequest as never}],
    ]);
    runtime.networkCollector.seedPageData(targetPage as never, [
      [{stableId: 2, request: targetRequest as never}],
    ]);

    const requests = runtime.getNetworkRequests(false, 1);

    assert.deepStrictEqual(requests, [targetRequest]);
    assert.equal(runtime.getNetworkRequestStableId(targetRequest), 2);
    assert.equal(runtime.getNetworkRequestById(2), targetRequest);
    assert.deepStrictEqual(
      runtime.getNetworkRequestsForPage(targetPage as never, false),
      [targetRequest],
    );
    runtime.clearNetworkRequestsForPage(targetPage as never);
    assert.deepStrictEqual(
      runtime.getNetworkRequestsForPage(targetPage as never, false),
      [],
    );
  });

  it('keeps context pageId stable while tabIndex follows reordering', () => {
    const runtime = new ToolContextProvider();
    const first = {
      isClosed: () => false,
      mainFrame: () => null,
      url: () => 'first',
      on: () => undefined,
    };
    const selected = {
      isClosed: () => false,
      mainFrame: () => null,
      url: () => 'selected',
      on: () => undefined,
    };

    runtime.setPages([first as never, selected as never]);
    runtime.setSelectedPage(selected as never);
    const stableId = runtime.getContextMeta().pageId;
    runtime.setPages([selected as never, first as never]);

    assert.equal(runtime.getContextMeta().pageId, stableId);
    assert.equal(runtime.getContextMeta().tabIndex, 0);
    assert.equal(runtime.resolvePage({pageId: stableId!}).page, selected);
    assert.equal(runtime.getSelectedPageIndex(), 0);
  });

  it('captures CDP traffic only from the selected page', async () => {
    const db = new DatabaseManager(':memory:');
    const store = new SqliteSessionStore(db);
    const manager = new CaptureSessionManager(store);
    const engine = new CaptureEngine(manager, store);
    const runtime = new ToolContextProvider({
      captureEngine: engine,
    } as unknown as Runtime);

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
    runtime.setContext(context);

    const pageA = {id: 'page-a', mainFrame: () => null} as unknown as Page;
    const pageB = {id: 'page-b'} as unknown as Page;
    const emit = (page: Page): void => {
      const response = {
        status: () => 200,
        headers: () => ({'content-type': 'text/plain'}),
        url: () => 'https://c.dev/probe',
        frame: () => ({page: () => page}),
        request: () => ({
          method: () => 'GET',
          url: () => 'https://c.dev/probe',
          headers: () => ({}),
          postData: () => null,
        }),
        text: async () => 'pong',
      } as unknown as Response;
      for (const listener of [...listeners]) listener(response);
    };
    const flush = (): Promise<void> =>
      new Promise(resolve => setImmediate(resolve));

    runtime.setSelectedPage(pageA);
    emit(pageA);
    await flush();
    let session = manager.getActiveSession();
    assert.ok(session, '选中页 A 的响应必须落库');
    assert.strictEqual(manager.getRequests(session.id).length, 1);

    emit(pageB);
    await flush();
    session = manager.getActiveSession();
    assert.ok(session);
    assert.strictEqual(
      manager.getRequests(session.id).length,
      1,
      '非选中页 B 的响应必须被源头丢弃',
    );

    // 无选中页（setContext → syncPages 之间的窗口）必须降级为不过滤，
    // 否则该窗口内的 CDP 响应会被静默全部丢弃。
    runtime.setSelectedPage(null);
    emit(pageB);
    await flush();
    session = manager.getActiveSession();
    assert.ok(session);
    assert.strictEqual(
      manager.getRequests(session.id).length,
      2,
      '无选中页 = 不过滤（spec §4 缺省安全行为）',
    );

    db.close();
  });
});
