/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Page} from 'patchright';

import {loadStaticToolsManifest} from '../../../src/cli/tools-manifest-loader.js';
import {STATIC_TOOL_HANDLERS} from '../../../src/tools/generated-tools-index.js';
import {
  definePageTool,
  isPageToolDefinition,
} from '../../../src/tools/ToolDefinition.js';
import {
  ensureToolsMeta,
  getToolMeta,
  type ToolMeta,
} from '../../../src/tools/tools-meta.js';
import {ErrorCodes, ToolError} from '../../../src/utils/errors.js';
import {PageHealthTracker} from '../../../src/worker/context/PageHealthTracker.js';
import {SessionContext} from '../../../src/worker/SessionContext.js';
import {ToolCallContextGuard} from '../../../src/worker/ToolCallContextGuard.js';
import {ToolExecutor} from '../../../src/worker/ToolExecutor.js';

const BROWSER_SCOPED_TOOLS = new Set([
  'list_pages',
  'select_page',
  'close_page',
  'new_page',
  'check_browser_health',
  'list_persistent_hooks',
  'wasm_dump',
  'list_targets',
  'dump_target_scripts',
  'install_extension',
  'uninstall_extension',
  'list_extensions',
  'reload_extension',
  'trigger_extension_action',
]);

const STATELESS_TOOLS = new Set(['diagnose_environment', 'collection_diff']);

function createFakePage(initialUrl: string) {
  let currentUrl = initialUrl;
  let viewport: {width: number; height: number} | null = null;
  let closed = false;
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const navigatedUrls: string[] = [];

  const mainFrame = {
    url: () => currentUrl,
    name: () => `main:${initialUrl}`,
    parentFrame: () => null,
    page: () => page,
    evaluate: async () => ({}),
  };
  const childFrame = {
    url: () => `${initialUrl}iframe`,
    name: () => `child:${initialUrl}`,
    parentFrame: () => mainFrame,
    page: () => page,
    evaluate: async () => ({}),
  };

  const page = {
    url: () => currentUrl,
    title: async () => `Title:${currentUrl}`,
    isClosed: () => closed,
    mainFrame: () => mainFrame,
    frames: () => [mainFrame, childFrame],
    goto: async (url: string) => {
      currentUrl = url;
      navigatedUrls.push(url);
    },
    setViewportSize: async (size: {width: number; height: number}) => {
      viewport = size;
    },
    getViewport: () => viewport,
    getNavigatedUrls: () => navigatedUrls,
    evaluate: async () => 'scrolled',
    on: (ev: string, fn: (...args: unknown[]) => void) => {
      const list = listeners.get(ev) ?? [];
      list.push(fn);
      listeners.set(ev, list);
    },
    off: (ev: string, fn: (...args: unknown[]) => void) => {
      const list = listeners.get(ev) ?? [];
      listeners.set(
        ev,
        list.filter(item => item !== fn),
      );
    },
    once: (ev: string, fn: (...args: unknown[]) => void) => {
      const list = listeners.get(ev) ?? [];
      list.push(fn);
      listeners.set(ev, list);
    },
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    bringToFront: async () => undefined,
    close: async () => {
      closed = true;
      for (const fn of listeners.get('close') ?? []) {
        fn();
      }
    },
    emitDialog: (dialog: unknown) => {
      for (const fn of listeners.get('dialog') ?? []) {
        fn(dialog);
      }
    },
  };
  return page;
}

describe('pageId multi-tab routing across browsercli tools', () => {
  it('assigns explicit scope to all 90 tools and exposes optional pageId on every page-scoped tool', async () => {
    await ensureToolsMeta();
    const manifest = loadStaticToolsManifest();
    assert.ok(manifest, 'tools-manifest.json must exist');
    const manifestByName = new Map(manifest.tools.map(t => [t.name, t]));

    let pageScopedCount = 0;
    let browserScopedCount = 0;
    let statelessCount = 0;

    for (const def of Object.values(STATIC_TOOL_HANDLERS)) {
      assert.ok(
        def.scope === 'page' ||
          def.scope === 'browser' ||
          def.scope === 'stateless',
        `tool "${def.name}" must declare an explicit scope (page/browser/stateless)`,
      );

      const meta = manifestByName.get(def.name);
      assert.ok(meta, `tool "${def.name}" must exist in tools-manifest.json`);

      if (def.scope === 'page') {
        pageScopedCount += 1;
        assert.ok(
          isPageToolDefinition(def),
          `${def.name} must satisfy isPageToolDefinition`,
        );
        assert.ok(
          'pageId' in def.schema,
          `page-scoped tool "${def.name}" must include pageId in schema`,
        );
        const pageIdSpec = meta.argSpecs.pageId;
        assert.ok(
          pageIdSpec,
          `page-scoped tool "${def.name}" must expose pageId in tools-manifest.json`,
        );
        assert.equal(pageIdSpec.type, 'string', def.name);
        assert.equal(pageIdSpec.required, false, def.name);
      } else if (def.scope === 'browser') {
        browserScopedCount += 1;
        assert.ok(
          BROWSER_SCOPED_TOOLS.has(def.name),
          `unexpected browser-scoped tool "${def.name}"`,
        );
        if (def.name !== 'select_page' && def.name !== 'close_page') {
          assert.equal(
            meta.argSpecs.pageId,
            undefined,
            `browser-scoped tool "${def.name}" should not inject pageId`,
          );
        }
      } else {
        statelessCount += 1;
        assert.ok(
          STATELESS_TOOLS.has(def.name),
          `unexpected stateless tool "${def.name}"`,
        );
        assert.equal(
          meta.argSpecs.pageId,
          undefined,
          `stateless tool "${def.name}" should not inject pageId`,
        );
      }
    }

    assert.equal(pageScopedCount, 74);
    assert.equal(browserScopedCount, 14);
    assert.equal(statelessCount, 2);
  });

  it('routes navigate_page, resize_page, list_frames, and select_frame via pageId without switching selectedPage', async () => {
    await ensureToolsMeta();
    const session = new SessionContext();
    const pageA = createFakePage('https://a.example/');
    const pageB = createFakePage('https://b.example/');
    session.setPages([pageA as unknown as Page, pageB as unknown as Page]);
    session.selectPage(pageA as unknown as Page);

    const pageAId = session.getPageId(pageA as unknown as Page);
    const pageBId = session.getPageId(pageB as unknown as Page);
    assert.equal(pageAId, '1');
    assert.equal(pageBId, '2');
    const contextGuard = new ToolCallContextGuard(() => session);
    const executor = new ToolExecutor({session, contextGuard});

    // 1. navigate_page targeting page 2 using numeric pageId (2)
    const navMeta = getToolMeta('navigate_page')!;
    const navRes = (await executor.execute(navMeta, {
      url: 'https://b-next.example/',
      pageId: 2,
    })) as {structuredContent: Record<string, unknown>};

    assert.equal(navRes.structuredContent.success, true);
    assert.deepEqual(pageB.getNavigatedUrls(), ['https://b-next.example/']);
    assert.deepEqual(pageA.getNavigatedUrls(), []);
    assert.equal(session.getSelectedPage(), pageA as unknown as Page);

    // 2. resize_page targeting page 2 using legacy "page-2" prefix (backward compatible)
    const resizeMeta = getToolMeta('resize_page')!;
    await executor.execute(resizeMeta, {
      width: 1440,
      height: 900,
      pageId: 'page-2',
    });
    assert.deepEqual(pageB.getViewport(), {width: 1440, height: 900});
    assert.equal(pageA.getViewport(), null);
    assert.equal(session.getSelectedPage(), pageA as unknown as Page);

    // 3. select_frame on page-2 does not mutate page-1's selected frame
    const selectFrameMeta = getToolMeta('select_frame')!;
    const listFramesMeta = getToolMeta('list_frames')!;
    await executor.execute(selectFrameMeta, {frameIdx: 1, pageId: pageBId});

    const framesA = (await executor.execute(listFramesMeta, {
      pageId: pageAId,
    })) as {structuredContent: {data: {selectedIndex: number}}};
    const framesB = (await executor.execute(listFramesMeta, {
      pageId: pageBId,
    })) as {structuredContent: {data: {selectedIndex: number}}};

    // pageA still has main frame (index 0) selected, pageB has child frame (index 1)
    assert.equal(framesA.structuredContent.data.selectedIndex, 0);
    assert.equal(framesB.structuredContent.data.selectedIndex, 1);
    assert.equal(session.getSelectedPage(), pageA as unknown as Page);

    // 4. ContextGuard _tabContext reflects targeted pageId (page-2)
    const framesBWithMeta = (await executor.execute(listFramesMeta, {
      pageId: pageBId,
    })) as {
      structuredContent: {
        data?: unknown;
        _tabContext?: {pageId: string; tabIndex: number};
      };
    };
    // list_frames starts with 'list_' (not context-sensitive prefix), so verify with page-prefixed probe
    assert.equal(framesBWithMeta.structuredContent.data !== undefined, true);
  });

  it('routes list_network_requests and clear_network_requests via pageId using targetPage-bound NetworkServices', async () => {
    await ensureToolsMeta();
    const session = new SessionContext();
    const pageA = createFakePage('https://a.example/');
    const pageB = createFakePage('https://b.example/');
    session.setPages([pageA as unknown as Page, pageB as unknown as Page]);
    session.selectPage(pageA as unknown as Page);

    const pageBId = session.getPageId(pageB as unknown as Page);
    const executor = new ToolExecutor({session});

    const listNetMeta = getToolMeta('list_network_requests')!;
    const listRes = (await executor.execute(listNetMeta, {
      pageId: pageBId,
    })) as {
      structuredContent: {
        success: boolean;
        data: {targetPageId: string; targetPageIdx: number};
      };
    };

    assert.equal(listRes.structuredContent.success, true);
    assert.equal(listRes.structuredContent.data.targetPageId, pageBId);
    assert.equal(listRes.structuredContent.data.targetPageIdx, 1);
    assert.equal(session.getSelectedPage(), pageA as unknown as Page);

    // Same page in plain numeric vs legacy page-N form must succeed without conflict
    const compatRes = (await executor.execute(listNetMeta, {
      pageId: '2',
      targetPageId: 'page-2',
    })) as {
      structuredContent: {success: boolean; data: {targetPageId: string}};
    };
    assert.equal(compatRes.structuredContent.success, true);
    assert.equal(compatRes.structuredContent.data.targetPageId, '2');

    // Conflicting pageId and targetPageId must fail validation
    const pageAId = session.getPageId(pageA as unknown as Page);
    await assert.rejects(
      executor.execute(listNetMeta, {
        pageId: pageBId,
        targetPageId: pageAId,
      }),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );

    const clearNetMeta = getToolMeta('clear_network_requests')!;
    const clearRes = (await executor.execute(clearNetMeta, {
      pageId: pageBId,
    })) as {
      structuredContent: {
        success: boolean;
        data: {targetPageId: string; targetPageIdx: number};
      };
    };
    assert.equal(clearRes.structuredContent.success, true);
    assert.equal(clearRes.structuredContent.data.targetPageId, pageBId);
    assert.equal(clearRes.structuredContent.data.targetPageIdx, 1);
  });

  it('isolates dialog blocking, page health, _tabContext, and page-level concurrency per pageId', async () => {
    const session = new SessionContext({
      healthTracker: new PageHealthTracker(),
    });
    const pageA = createFakePage('https://a.example/');
    const pageB = createFakePage('https://b.example/');
    session.setPages([pageA as unknown as Page, pageB as unknown as Page]);
    session.selectPage(pageA as unknown as Page);

    const pageAId = session.getPageId(pageA as unknown as Page);
    const pageBId = session.getPageId(pageB as unknown as Page);

    // Put pageA in dialog-blocked + unhealthy state while pageB stays healthy
    pageA.emitDialog({type: () => 'alert', message: () => 'blocking'});
    session.healthTracker.recordTimeout(pageAId);
    session.healthTracker.recordTimeout(pageAId);
    session.healthTracker.recordTimeout(pageAId);
    assert.equal(session.healthTracker.isPageHealthy(pageAId), false);
    assert.equal(session.healthTracker.isPageHealthy(pageBId), true);

    const probeTool = definePageTool({
      name: 'page_probe_isolation',
      description: 'Probe isolation',
      annotations: {category: 'pages' as never, readOnlyHint: true},
      blockedByDialog: true,
      concurrency: 'page',
      schema: {},
      handler: async (request, response) => {
        response.setStructuredContent({
          success: true,
          routedPageId: request.page.id,
        });
      },
    });

    const contextGuard = new ToolCallContextGuard(() => session);
    const executor = new ToolExecutor({
      session,
      contextGuard,
      staticHandlers: {'./probe.js:probeTool': probeTool as never},
    });
    const probeMeta: ToolMeta = {
      name: 'page_probe_isolation',
      description: 'Probe',
      schema: {pageId: 'string'},
      argSpecs: {
        pageId: {type: 'string', required: false, description: 'pageId'},
      },
      modulePath: './probe.js',
      handlerName: 'probeTool',
      callMode: 'defineTool',
      domain: 'probe',
      profile: 'workflow',
      requirements: {page: 'selected'},
    };

    // Calling without pageId targets unhealthy pageA -> fails PAGE_UNRESPONSIVE
    await assert.rejects(
      executor.execute(probeMeta, {}),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.PAGE_UNRESPONSIVE,
    );

    // Calling with --pageId pageB bypasses pageA's unhealthy + dialog state and reports pageB in _tabContext
    const resB = (await executor.execute(probeMeta, {
      pageId: pageBId,
    })) as {
      structuredContent: {
        routedPageId: string;
        _tabContext?: {pageId: string; tabIndex: number; url: string};
      };
    };
    assert.equal(resB.structuredContent.routedPageId, pageBId);
    assert.equal(resB.structuredContent._tabContext?.pageId, pageBId);
    assert.equal(resB.structuredContent._tabContext?.tabIndex, 1);
    assert.equal(resB.structuredContent._tabContext?.url, 'https://b.example/');
    // pageA remains unhealthy and selected
    assert.equal(session.healthTracker.isPageHealthy(pageAId), false);
    assert.equal(session.getSelectedPage(), pageA as unknown as Page);
  });

  it('runs page-scoped tools on different pageIds concurrently while serializing the same pageId', async () => {
    const session = new SessionContext({
      healthTracker: new PageHealthTracker(),
    });
    const pageA = createFakePage('https://a.example/');
    const pageB = createFakePage('https://b.example/');
    session.setPages([pageA as unknown as Page, pageB as unknown as Page]);
    session.selectPage(pageA as unknown as Page);

    const pageAId = session.getPageId(pageA as unknown as Page);
    const pageBId = session.getPageId(pageB as unknown as Page);

    const events: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>(resolve => {
      releaseA = resolve;
    });

    const slowProbe = definePageTool({
      name: 'slow_page_probe',
      description: 'Slow probe',
      annotations: {category: 'pages' as never, readOnlyHint: true},
      concurrency: 'page',
      schema: {},
      handler: async (request, response) => {
        events.push(`start:${request.page.id}`);
        if (request.page.id === pageAId) {
          await gateA;
        }
        events.push(`end:${request.page.id}`);
        response.setStructuredContent({ok: true, pageId: request.page.id});
      },
    });

    const executor = new ToolExecutor({
      session,
      staticHandlers: {'./slow.js:slowProbe': slowProbe as never},
    });
    const slowMeta: ToolMeta = {
      name: 'slow_page_probe',
      description: 'Slow',
      schema: {pageId: 'string'},
      argSpecs: {
        pageId: {type: 'string', required: false, description: 'pageId'},
      },
      modulePath: './slow.js',
      handlerName: 'slowProbe',
      callMode: 'defineTool',
      domain: 'probe',
      profile: 'workflow',
    };

    const callA = executor.execute(slowMeta, {pageId: pageAId});
    await new Promise(r => setTimeout(r, 15));
    // Call targeting pageB must complete while pageA is still blocked
    await executor.execute(slowMeta, {pageId: pageBId});
    assert.deepEqual(events, [
      `start:${pageAId}`,
      `start:${pageBId}`,
      `end:${pageBId}`,
    ]);

    releaseA();
    await callA;
    assert.deepEqual(events, [
      `start:${pageAId}`,
      `start:${pageBId}`,
      `end:${pageBId}`,
      `end:${pageAId}`,
    ]);
  });

  it('rejects unknown/closed pageId with PAGE_NOT_FOUND and preserves offline fallback for requirePage=false tools', async () => {
    await ensureToolsMeta();
    const session = new SessionContext();
    const executor = new ToolExecutor({session});

    // Hybrid tool create_hook works offline when pageId is omitted
    const createHookMeta = getToolMeta('create_hook')!;
    const hookRes = (await executor.execute(createHookMeta, {
      type: 'fetch',
    })) as {structuredContent: {success: boolean}};
    assert.equal(hookRes.structuredContent.success, true);

    // Passing an unknown pageId to create_hook strictly fails with PAGE_NOT_FOUND
    await assert.rejects(
      executor.execute(createHookMeta, {
        type: 'fetch',
        pageId: 'page-999',
      }),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.PAGE_NOT_FOUND,
    );

    // Passing an unknown pageId to select_page (browser tool) goes through select_page's own NOT_FOUND error
    const selectPageMeta = getToolMeta('select_page')!;
    await assert.rejects(
      executor.execute(selectPageMeta, {pageId: 'page-999'}),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.NOT_FOUND,
    );
  });
});
