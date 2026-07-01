// @ts-nocheck
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getNetworkRequest,
  listNetworkRequests,
} from '../../../src/tools/network/index.js';
import {
  listPages,
  navigatePage,
  newPage,
  selectPage,
} from '../../../src/tools/navigation/index.js';
import {getRuntime} from '../../../src/runtime.js';
import {takeScreenshot as screenshot} from '../../../src/tools/screenshot/takeScreenshot.js';
import {evaluateScript} from '../../../src/tools/script/script.js';

interface BasicResponseState {
  includePages: boolean;
  includeNetwork: boolean;
  includeNetworkOpts?: {
    pageSize?: number;
    pageIdx?: number;
    resourceTypes?: string[];
    includePreservedRequests?: boolean;
    networkRequestIdInDevToolsUI?: number;
  };
}

interface ImageAttachment {
  mimeType: string;
  data?: string;
}

interface NetworkAttachment {
  reqid: number;
}

interface BasicResponseHarness {
  lines: string[];
  attached: Array<NetworkAttachment | ImageAttachment>;
  state: BasicResponseState;
  appendResponseLine(value: string): void;
  setIncludePages(value: boolean): void;
  setIncludeNetworkRequests(
    value: boolean,
    options?: BasicResponseState['includeNetworkOpts'],
  ): void;
  setIncludeConsoleData(value: boolean): void;
  attachImage(value: ImageAttachment): void;
  attachNetworkRequest(id: number): void;
  attachConsoleMessage(id: number): void;
  setIncludeWebSocketConnections(value: boolean): void;
  attachWebSocket(id: number): void;
  setStructuredContent(content: unknown): void;
}

interface TestPageHarness {
  currentUrl?: string;
  bringToFront(): Promise<void>;
  goto(url: string, options?: unknown): Promise<void>;
  goBack(options?: unknown): Promise<void>;
  goForward(options?: unknown): Promise<void>;
  reload(options?: unknown): Promise<void>;
  url(): string;
  screenshot(options: unknown): Promise<Uint8Array>;
  evaluateHandle(script: string): Promise<{dispose(): Promise<void>}>;
  evaluate(fnHandle: unknown): Promise<string>;
  isClosed?(): boolean;
  title?(): Promise<string>;
}

interface TestFrameHarness {
  evaluateHandle(script: string): Promise<{dispose(): Promise<void>}>;
  evaluate(fn: unknown, arg: unknown): Promise<string>;
}

interface PageToolContextHarness {
  getPageByIdx(idx: number): TestPageHarness;
  selectPage(page: TestPageHarness): void;
  newPage(): Promise<TestPageHarness>;
  waitForEventsAfterAction(action: () => Promise<void>): Promise<void>;
  getSelectedPage(): TestPageHarness;
}

interface NetworkContextHarness {
  getDevToolsData(): Promise<{cdpRequestId?: string}>;
  resolveCdpRequestId(id: string): number | undefined;
}

interface ScreenshotContextHarness {
  getSelectedPage(): TestPageHarness;
  saveFile(data: Uint8Array, filename: string): Promise<{filename: string}>;
  saveTemporaryFile(
    data: Uint8Array,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  ): Promise<{filename: string}>;
}

interface ScriptContextHarness {
  getSelectedPage(): TestPageHarness;
  getSelectedFrame(): TestFrameHarness;
  waitForEventsAfterAction(action: () => Promise<void>): Promise<void>;
}

function makeResponse(): BasicResponseHarness {
  const lines: string[] = [];
  const attached: Array<NetworkAttachment | ImageAttachment> = [];
  const state: BasicResponseState = {
    includePages: false,
    includeNetwork: false,
    includeNetworkOpts: undefined,
  };

  return {
    lines,
    attached,
    state,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: (v: boolean) => {
      state.includePages = v;
    },
    setIncludeNetworkRequests: (
      v: boolean,
      opts?: BasicResponseState['includeNetworkOpts'],
    ) => {
      state.includeNetwork = v;
      state.includeNetworkOpts = opts;
    },
    setIncludeConsoleData: () => undefined,
    attachImage: (v: ImageAttachment) => attached.push(v),
    attachNetworkRequest: (id: number) => attached.push({reqid: id}),
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
    setStructuredContent: (content: unknown) => {
      lines.push(JSON.stringify(content));
    },
  };
}

function parseLastJsonResult(response: BasicResponseHarness): any {
  for (let i = response.lines.length - 1; i >= 0; i--) {
    const line = response.lines[i].trim();
    if (line.startsWith('{')) {
      return JSON.parse(line);
    }
  }
  throw new Error(
    'No JSON line found in response lines: ' + response.lines.join('\n'),
  );
}

describe('tools extended coverage', () => {
  it('covers list/select/new page and navigate branches', async () => {
    const response = makeResponse();

    const selected = {idx: -1};
    const syncedPages: TestPageHarness[] = [];
    const page: TestPageHarness = {
      currentUrl: 'https://now.example',
      bringToFront: async () => {
        selected.idx = 1;
      },
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => page.currentUrl ?? '',
      screenshot: async () => new Uint8Array(),
      evaluateHandle: async () => ({dispose: async () => undefined}),
      evaluate: async () => '',
      title: async () => 'mock-title',
    };

    const context = {
      getPages: () => [page],
      getPageByIdx: () => page,
      selectPage: (p: TestPageHarness) => {
        selected.idx = p === page ? 2 : -2;
      },
      bringPageToFront: async () => {
        selected.idx = 1;
      },
      syncPageContext: (selectedPage: TestPageHarness) => {
        syncedPages.push(selectedPage);
      },
      newPage: async () => page,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
      getSelectedPage: () => page,
    };

    const runtime = getRuntime();
    const originalProvider = runtime.contextProvider;
    runtime.contextProvider = context as any;

    try {
      await listPages.handler(
        {params: {}},
        response as unknown as Parameters<typeof listPages.handler>[1],
        context as unknown as Parameters<typeof listPages.handler>[2],
        runtime as unknown as Parameters<typeof listPages.handler>[3],
      );
      const listPagesResult = parseLastJsonResult(response);
      assert.strictEqual(listPagesResult.success, true);
      assert.strictEqual(listPagesResult.tooltype, 'list_pages');

      await selectPage.handler(
        {params: {pageIdx: 0}},
        response as unknown as Parameters<typeof selectPage.handler>[1],
        context as unknown as Parameters<typeof selectPage.handler>[2],
        runtime as unknown as Parameters<typeof selectPage.handler>[3],
      );
      assert.strictEqual(selected.idx, 2);
      assert.deepStrictEqual(syncedPages, [page]);

      await newPage.handler(
        {params: {url: 'https://a.com'}},
        response as unknown as Parameters<typeof newPage.handler>[1],
        context as unknown as Parameters<typeof newPage.handler>[2],
        runtime as unknown as Parameters<typeof newPage.handler>[3],
      );
      const newPageResult = parseLastJsonResult(response);
      assert.strictEqual(newPageResult.success, true);
      assert.strictEqual(newPageResult.tooltype, 'new_page');

      await assert.rejects(async () => {
        await navigatePage.handler(
          {params: {}},
          response as unknown as Parameters<typeof navigatePage.handler>[1],
          context as unknown as Parameters<typeof navigatePage.handler>[2],
          runtime as unknown as Parameters<typeof navigatePage.handler>[3],
        );
      }, /导航类型为 url 时必须提供 url 参数/);

      await navigatePage.handler(
        {params: {url: 'https://b.com'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
        runtime as unknown as Parameters<typeof navigatePage.handler>[3],
      );
      assert.strictEqual(parseLastJsonResult(response).success, true);

      page.goto = async () => {
        throw new Error('goto failed');
      };
      await navigatePage.handler(
        {params: {type: 'url', url: 'https://c.com'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
        runtime as unknown as Parameters<typeof navigatePage.handler>[3],
      );
      assert.strictEqual(parseLastJsonResult(response).success, false);

      page.goBack = async () => {
        throw new Error('back failed');
      };
      await navigatePage.handler(
        {params: {type: 'back'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
        runtime as unknown as Parameters<typeof navigatePage.handler>[3],
      );
      assert.strictEqual(parseLastJsonResult(response).success, false);

      page.goForward = async () => {
        throw new Error('forward failed');
      };
      await navigatePage.handler(
        {params: {type: 'forward'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
        runtime as unknown as Parameters<typeof navigatePage.handler>[3],
      );
      assert.strictEqual(parseLastJsonResult(response).success, false);

      page.reload = async () => {
        throw new Error('reload failed');
      };
      await navigatePage.handler(
        {params: {type: 'reload', ignoreCache: true}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
        runtime as unknown as Parameters<typeof navigatePage.handler>[3],
      );
      assert.strictEqual(parseLastJsonResult(response).success, false);
    } finally {
      runtime.contextProvider = originalProvider;
    }
  });

  it('covers network list/get branches', async () => {
    const response = makeResponse();
    const runtime = getRuntime();

    const mockRequest = {
      url: () => 'https://example.com/api',
      method: () => 'GET',
      resourceType: () => 'xhr',
      headers: () => ({}),
      postData: () => undefined,
      response: async () => ({
        status: () => 200,
        statusText: () => 'OK',
        headers: () => ({'content-type': 'application/json'}),
        text: async () => '{"success":true}',
      }),
    };

    const context = {
      getPages: () => [],
      getSelectedPage: () => ({}),
      getSelectedPageIndex: () => 12,
      getNetworkRequests: () => [mockRequest as any],
      getNetworkRequestById: (id: number) => mockRequest as any,
      getNetworkRequestStableId: (request: any) => 12,
      getRequestInitiator: (request: any) => ({
        type: 'script',
        stack: {
          callFrames: [
            {
              functionName: 'foo',
              scriptId: '1',
              url: 'https://example.com/foo.js',
              lineNumber: 10,
              columnNumber: 20,
            },
          ],
        },
      }),
      getDevToolsData: async () => ({cdpRequestId: 'abc'}),
      resolveCdpRequestId: (id: string) => (id === 'abc' ? 12 : undefined),
    };

    const originalProvider = runtime.contextProvider;
    runtime.contextProvider = context as any;

    try {
      await listNetworkRequests.handler(
        {
          params: {
            pageSize: 10,
            pageIdx: 1,
            resourceTypes: ['xhr'],
            includePreservedRequests: true,
          },
        },
        response as unknown as Parameters<
          typeof listNetworkRequests.handler
        >[1],
      );

      const listResult = parseLastJsonResult(response);
      assert.strictEqual(listResult.success, true);
      assert.strictEqual(listResult.tooltype, 'list_network_requests');
      assert.strictEqual(listResult.data.targetPageIdx, 12);

      await getNetworkRequest.handler(
        {params: {reqid: 33}},
        response as unknown as Parameters<typeof getNetworkRequest.handler>[1],
      );
      const getResult33 = parseLastJsonResult(response);
      assert.strictEqual(getResult33.success, true);
      assert.strictEqual(getResult33.data.reqid, 33);
      assert.ok(getResult33.data.stack);
      assert.strictEqual(
        getResult33.data.stack.callFrames[0].functionName,
        'foo',
      );

      await getNetworkRequest.handler(
        {params: {}},
        response as unknown as Parameters<typeof getNetworkRequest.handler>[1],
      );
      const getResultDefault = parseLastJsonResult(response);
      assert.strictEqual(getResultDefault.success, true);
      assert.strictEqual(getResultDefault.data.reqid, 12);

      context.getDevToolsData = async () => ({});
      await getNetworkRequest.handler(
        {params: {}},
        response as unknown as Parameters<typeof getNetworkRequest.handler>[1],
      );
      const getResultNone = parseLastJsonResult(response);
      assert.strictEqual(getResultNone.success, false);
      assert.ok(getResultNone.message.includes('未指定 reqid'));
    } finally {
      runtime.contextProvider = originalProvider;
    }
  });

  it('covers screenshot branches: save file, temp file and attach image', async () => {
    const response = makeResponse();

    const small = Buffer.from('small-image');
    const large = Buffer.alloc(2_000_001, 1);
    let call = 0;

    const page: TestPageHarness = {
      screenshot: async () => {
        call += 1;
        return call === 2 ? large : small;
      },
      bringToFront: async () => undefined,
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => '',
      evaluateHandle: async () => ({dispose: async () => undefined}),
      evaluate: async () => '',
      isClosed: () => false,
    };

    const context = {
      getActivePage: async () => page,
      getSelectedPage: () => page,
      saveFile: async (_data: Uint8Array, filename: string) => ({filename}),
      saveTemporaryFile: async () => ({filename: '/tmp/shot.png'}),
    };

    const runtime = getRuntime();
    const originalProvider = runtime.contextProvider;
    runtime.contextProvider = context as any;

    try {
      await screenshot.handler(
        {params: {format: 'png', fullPage: true, filePath: '/tmp/a.png'}},
        response as unknown as Parameters<typeof screenshot.handler>[1],
        context as any,
      );
      const res1 = parseLastJsonResult(response);
      assert.strictEqual(res1.success, true);
      assert.ok(res1.message.includes('full current page'));
      assert.ok(res1.data.savedPath.replace(/\\/g, '/').endsWith('/tmp/a.png'));

      await screenshot.handler(
        {params: {format: 'jpeg', quality: 80, fullPage: false}},
        response as unknown as Parameters<typeof screenshot.handler>[1],
        context as any,
      );
      const res2 = parseLastJsonResult(response);
      assert.strictEqual(res2.success, true);
      assert.ok(
        res2.data.savedPath.replace(/\\/g, '/').endsWith('/tmp/shot.png'),
      );

      await screenshot.handler(
        {params: {format: 'webp', fullPage: false}},
        response as unknown as Parameters<typeof screenshot.handler>[1],
        context as any,
      );
      const res3 = parseLastJsonResult(response);
      assert.strictEqual(res3.success, true);
      assert.ok(
        response.attached.some(
          x => 'mimeType' in x && x.mimeType === 'image/webp',
        ),
      );
    } finally {
      runtime.contextProvider = originalProvider;
    }
  });

  it('covers evaluateScript success and dispose-on-error path', async () => {
    const response = makeResponse();
    let disposed = 0;

    const fnHandle = {
      dispose: async () => {
        disposed += 1;
      },
    };

    const frameSuccess: TestFrameHarness = {
      evaluateHandle: async () => fnHandle,
      evaluate: async () => '{"ok":true}',
    };

    const pageSuccess: TestPageHarness = {
      bringToFront: async () => undefined,
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => '',
      screenshot: async () => new Uint8Array(),
      evaluateHandle: async () => fnHandle,
      evaluate: async () => '{"ok":true}',
    };

    const contextSuccess: ScriptContextHarness = {
      getSelectedPage: () => pageSuccess,
      getSelectedFrame: () => frameSuccess,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    const runtime = getRuntime();
    const originalProvider = runtime.contextProvider;
    runtime.contextProvider = contextSuccess as any;

    try {
      await evaluateScript.handler(
        {params: {function: '() => ({ ok: true })'}},
        response as unknown as Parameters<typeof evaluateScript.handler>[1],
      );
    } finally {
      runtime.contextProvider = originalProvider;
    }

    assert.ok(
      response.lines.some(x => x.includes('Script ran on page and returned')),
    );
    assert.strictEqual(disposed, 1);

    const frameError: TestFrameHarness = {
      evaluateHandle: async () => fnHandle,
      evaluate: async () => {
        throw new Error('eval failed');
      },
    };

    const pageError: TestPageHarness = {
      bringToFront: async () => undefined,
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => '',
      screenshot: async () => new Uint8Array(),
      evaluateHandle: async () => fnHandle,
      evaluate: async () => {
        throw new Error('eval failed');
      },
    };

    const contextError: ScriptContextHarness = {
      getSelectedPage: () => pageError,
      getSelectedFrame: () => frameError,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    runtime.contextProvider = contextError as any;
    try {
      await evaluateScript.handler(
        {params: {function: '() => { throw new Error("x") }'}},
        response as unknown as Parameters<typeof evaluateScript.handler>[1],
      );
      const evalErrResult = parseLastJsonResult(response);
      assert.strictEqual(evalErrResult.success, false);
    } finally {
      runtime.contextProvider = originalProvider;
    }
    assert.strictEqual(disposed, 2);
  });

  it('covers jshook runtime singleton creation', () => {
    const first = getRuntime();
    const second = getRuntime();

    assert.ok(first.browserManager);
    assert.ok(first.collector);
    assert.ok(first.hookManager);
    assert.strictEqual(first, second);
  });
});
