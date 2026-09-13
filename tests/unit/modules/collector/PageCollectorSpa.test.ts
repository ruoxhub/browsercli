/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PageCollector} from '../../../../src/modules/collector/PageCollector.js';

interface Tracked {
  stableId: number;
}

/** Minimal page mock wired like patchright: framenavigated + CDP nwid events. */
function makePage() {
  const pageListeners = new Map<string, (...args: unknown[]) => void>();
  const onceListeners = new Map<string, (...args: unknown[]) => void>();
  const cdpListeners = new Map<string, (event: unknown) => void>();
  const detachCalls: number[] = [];
  const mainFrame = {frameId: 'main'};
  const page = {
    mainFrame: () => mainFrame,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      pageListeners.set(event, handler);
    },
    once: (event: string, handler: (...args: unknown[]) => void) => {
      onceListeners.set(event, handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      if (pageListeners.get(event) === handler) pageListeners.delete(event);
    },
    context: () => ({
      newCDPSession: async () => ({
        on: (event: string, handler: (e: unknown) => void) => {
          cdpListeners.set(event, handler);
        },
        off: () => undefined,
        send: async (method: string) => {
          sent.push(method);
          if (method === 'Page.getFrameTree') {
            return {frameTree: {frame: {id: 'main'}}};
          }
          return {};
        },
        detach: async () => {
          detachCalls.push(1);
        },
      }),
      pages: () => [page],
    }),
  };
  const sent: string[] = [];
  const emitFrameNav = (frame: unknown) =>
    pageListeners.get('framenavigated')?.(frame);
  const emitNwid = (frameId = 'main') =>
    cdpListeners.get('Page.navigatedWithinDocument')?.({frameId});
  const closePage = () => onceListeners.get('close')?.();
  return {
    page,
    emitFrameNav,
    emitNwid,
    closePage,
    mainFrame,
    sent,
    detachCalls,
  };
}

class TestCollector extends PageCollector<Tracked> {
  splitCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
  protected attachListeners(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
  protected detachListeners(): void {}
  protected override splitOnNavigation(): void {
    this.splitCount++;
  }
}

/** Yield to the event loop so setImmediate-deferred splits run. */
const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

describe('PageCollector SPA navigation handling', () => {
  it('does not split storage on same-document navigation (nwid arrives after framenavigated)', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush(); // let the CDP session attach resolve
    emitFrameNav(mainFrame);
    emitNwid(); // same tick — before the deferred split
    await flush();

    assert.equal(
      collector.splitCount,
      0,
      'SPA same-doc navigation must NOT split',
    );
  });

  it('splits storage on cross-document navigation (no nwid)', async () => {
    const {page, emitFrameNav, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    emitFrameNav(mainFrame);
    await flush();

    assert.equal(collector.splitCount, 1, 'cross-doc navigation must split');
  });

  it('splits after a same-document navigation when a real navigation follows', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    // SPA route change
    emitFrameNav(mainFrame);
    emitNwid();
    await flush();
    assert.equal(collector.splitCount, 0);
    // then a real navigation
    emitFrameNav(mainFrame);
    await flush();
    assert.equal(collector.splitCount, 1);
  });

  it('ignores sub-frame navigations entirely', async () => {
    const {page, emitFrameNav} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    emitFrameNav({frameId: 'iframe-1'});
    await flush();

    assert.equal(collector.splitCount, 0);
  });

  it('does not let a sub-frame nwid cancel a pending main-frame split', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    // 主 frame 跨文档导航，同 tick 内子 frame 发 nwid（如 iframe pushState）。
    emitFrameNav(mainFrame);
    emitNwid('iframe-1');
    await flush();

    assert.equal(
      collector.splitCount,
      1,
      'sub-frame nwid must not cancel the main-frame cross-doc split',
    );
  });

  it('handles rapid successive same-doc navigations', async () => {
    const {page, emitFrameNav, emitNwid, mainFrame} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);

    await flush();
    emitFrameNav(mainFrame);
    emitNwid();
    emitFrameNav(mainFrame);
    emitNwid();
    emitFrameNav(mainFrame);
    emitNwid();
    await flush();

    assert.equal(collector.splitCount, 0);
  });

  it('detaches a CDP session that resolves after the page closed', async () => {
    const {page, closePage, detachCalls} = makePage();
    const collector = new TestCollector();
    collector.attachToPage(page as never);
    closePage(); // page detaches before newCDPSession resolves
    await flush();
    assert.equal(detachCalls.length, 1, 'late session must be detached');
    collector.dispose();
  });

  it('detaches every tracked page on dispose()', async () => {
    const {page, detachCalls} = makePage();
    const collector = new TestCollector();
    const context = {
      pages: () => [page],
      on: () => undefined,
      off: () => undefined,
    };
    collector.startContextCollection(context as never);
    await flush();
    detachCalls.length = 0; // 忽略 attach 期间可能发生的 detach

    collector.dispose();

    assert.equal(
      detachCalls.length,
      1,
      'dispose 必须解挂已注册页面的 CDP 会话（重连路径不再泄漏）',
    );
  });
});
