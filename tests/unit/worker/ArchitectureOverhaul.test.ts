/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import type {Page} from 'patchright';

import {loadStaticToolsManifest} from '../../../src/cli/tools-manifest-loader.js';
import {zod} from '../../../src/third_party/index.js';
import {STATIC_TOOL_HANDLERS} from '../../../src/tools/generated-tools-index.js';
import {
  defineBrowserTool,
  definePageTool,
  defineStatelessTool,
} from '../../../src/tools/ToolDefinition.js';
import type {ToolMeta} from '../../../src/tools/tools-meta.js';
import {SessionContext} from '../../../src/worker/SessionContext.js';
import {ToolExecutor} from '../../../src/worker/ToolExecutor.js';
import {ToolResponseAccumulator} from '../../../src/worker/ToolResponse.js';

function createFakePage(url: string) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let closed = false;
  const mainFrame = {name: () => `frame:${url}`};
  const page = {
    url: () => url,
    isClosed: () => closed,
    mainFrame: () => mainFrame,
    frames: () => [mainFrame],
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

describe('ADR-0008 / ADR-0009 / ADR-0010 architecture invariants', () => {
  it('routes definePageTool calls via optional pageId without mutating selectedPage', async () => {
    const session = new SessionContext();
    const pageA = createFakePage('https://a.example/');
    const pageB = createFakePage('https://b.example/');
    session.setPages([pageA as unknown as Page, pageB as unknown as Page]);
    session.selectPage(pageA as unknown as Page);

    const pageBId = session.getPageId(pageB as unknown as Page);
    const inspectedUrls: string[] = [];

    const inspectPageTool = definePageTool({
      name: 'inspect_page_probe',
      description: 'Probe page routing',
      annotations: {category: 'debugging' as never, readOnlyHint: true},
      schema: {
        label: zod.string().optional(),
      },
      handler: async (request, response, context) => {
        inspectedUrls.push(request.page.rawPage.url());
        response.setStructuredContent({
          routedPageId: request.page.id,
          url: request.page.rawPage.url(),
          contextPageUrl: context.getSelectedPage()?.url(),
        });
      },
    });

    assert.ok('pageId' in inspectPageTool.schema);
    assert.equal(inspectPageTool.scope, 'page');
    assert.equal(inspectPageTool.concurrency, 'page');

    const executor = new ToolExecutor({
      session,
      staticHandlers: {
        './probe.js:inspectPageTool': inspectPageTool as never,
      },
    });

    const meta: ToolMeta = {
      name: 'inspect_page_probe',
      description: 'Probe',
      schema: {},
      argSpecs: {},
      modulePath: './probe.js',
      handlerName: 'inspectPageTool',
      callMode: 'defineTool',
      domain: 'probe',
      profile: 'workflow',
    };

    const result = (await executor.execute(meta, {
      pageId: pageBId,
    })) as {structuredContent: Record<string, unknown>};

    assert.equal(result.structuredContent.routedPageId, pageBId);
    assert.equal(result.structuredContent.url, 'https://b.example/');
    assert.equal(result.structuredContent.contextPageUrl, 'https://b.example/');
    assert.equal(inspectedUrls[0], 'https://b.example/');
    // Global selectedPage must remain pageA
    assert.equal(session.getSelectedPage(), pageA as unknown as Page);
  });

  it('enforces compile-time tool scopes for browser and stateless tools', () => {
    const browserTool = defineBrowserTool({
      name: 'browser_probe',
      description: 'Browser probe',
      annotations: {category: 'pages' as never, readOnlyHint: true},
      schema: {},
      handler: async () => undefined,
    });
    const statelessTool = defineStatelessTool({
      name: 'stateless_probe',
      description: 'Stateless probe',
      annotations: {category: 'reverse' as never, readOnlyHint: true},
      schema: {},
      handler: async () => undefined,
    });

    assert.equal(browserTool.scope, 'browser');
    assert.equal(browserTool.blockedByDialog, false);
    assert.equal(browserTool.concurrency, 'exclusive');

    assert.equal(statelessTool.scope, 'stateless');
    assert.equal(statelessTool.blockedByDialog, false);
    assert.equal(statelessTool.concurrency, 'none');
  });

  it('isolates per-page dialog and hookStore and disposes cleanly on close', async () => {
    const session = new SessionContext();
    const pageA = createFakePage('https://a.example/');
    const pageB = createFakePage('https://b.example/');
    session.setPages([pageA as unknown as Page, pageB as unknown as Page]);

    const bpA = session.getOrCreateBrowserPage(pageA as unknown as Page);
    const bpB = session.getOrCreateBrowserPage(pageB as unknown as Page);

    bpA.getHookStore().add('hook_1', {hookId: 'hook_1', timestamp: 1});
    pageA.emitDialog({type: () => 'alert', message: () => 'hi'});

    assert.equal(bpA.getHookStore().get('hook_1').length, 1);
    assert.equal(bpB.getHookStore().get('hook_1').length, 0);
    assert.ok(bpA.getDialog());
    assert.equal(bpB.getDialog(), undefined);

    await pageA.close();
    assert.equal(bpA.isClosed(), true);
    assert.equal(bpA.getDialog(), undefined);
    assert.equal(bpA.getHookStore().get('hook_1').length, 0);
  });

  it('materializes declarative response directives instead of no-ops', async () => {
    const session = new SessionContext();
    const pageA = createFakePage('https://a.example/');
    session.setPages([pageA as unknown as Page]);
    session.selectPage(pageA as unknown as Page);

    const acc = new ToolResponseAccumulator();
    acc.setStructuredContent({ok: true});
    acc.setIncludePages(true);
    acc.attachImage({data: 'AAAA', mimeType: 'image/png'});
    acc.setIncludeConsoleData(true, {pageSize: 10, pageIdx: 0});
    acc.setIncludeNetworkRequests(true, {pageSize: 10, pageIdx: 0});

    await acc.materialize(session);
    const json = acc.toJSON() as {
      structuredContent: Record<string, unknown>;
      images?: unknown[];
      pages?: unknown[];
    };

    assert.equal(json.images?.length, 1);
    assert.equal(json.pages?.length, 1);
    assert.ok(Array.isArray(json.structuredContent.pages));
    assert.ok(json.structuredContent.console);
    assert.ok(json.structuredContent.network);
  });

  it('emulates focus via persistent CDP session once on selectPage without bringing tab to front', async () => {
    const session = new SessionContext();
    const sent: Array<{method: string; params?: Record<string, unknown>}> = [];
    let bringToFrontCalls = 0;
    let shouldFail = true;

    const fakeCdp = {
      send: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'Emulation.setFocusEmulationEnabled' && shouldFail) {
          shouldFail = false;
          throw new Error('transient cdp error');
        }
        sent.push({method, params});
        return {};
      },
    };

    const pageA = {
      ...createFakePage('https://a.example/'),
      bringToFront: async () => {
        bringToFrontCalls += 1;
      },
      context: () => ({
        newCDPSession: async () => fakeCdp,
      }),
    };

    session.setPages([pageA as unknown as Page]);

    // First selectPage hits transient error -> retries on next selectPage
    session.selectPage(pageA as unknown as Page);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sent.length, 0);

    // Second selectPage succeeds -> Emulation.setFocusEmulationEnabled(true)
    session.selectPage(pageA as unknown as Page);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(
      sent.filter(
        entry =>
          entry.method === 'Emulation.setFocusEmulationEnabled' &&
          entry.params?.enabled === true,
      ).length,
      1,
    );

    // Third selectPage is idempotent -> no duplicate focus emulation call
    session.selectPage(pageA as unknown as Page);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(
      sent.filter(
        entry => entry.method === 'Emulation.setFocusEmulationEnabled',
      ).length,
      1,
    );
    assert.equal(bringToFrontCalls, 0);
  });

  it('exposes 90 tools in STATIC_TOOL_HANDLERS and build-time tools-manifest.json', () => {
    assert.equal(Object.keys(STATIC_TOOL_HANDLERS).length, 90);
    const manifest = loadStaticToolsManifest();
    assert.ok(manifest, 'build/src/tools/tools-manifest.json must exist');
    assert.equal(manifest.count, 90);
    assert.equal(manifest.tools.length, 90);
  });
});
