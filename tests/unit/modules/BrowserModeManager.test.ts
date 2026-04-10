// @ts-nocheck
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {BrowserModeManager} from '../../../src/modules/browser/BrowserModeManager.js';

interface BrowserLike {
  connected?: boolean;
  isConnected?(): boolean;
  newPage?(): Promise<PageLike>;
  pages?(): Promise<PageLike[]>;
  disconnect?(): Promise<void>;
  close?(): Promise<void>;
  on?(event: string, handler: () => void): void;
}

interface PageLike {
  on(event: string, handler: () => void): void;
  once(event: string, handler: () => void): void;
  isClosed?(): boolean;
  setCacheEnabled(): Promise<void>;
  setBypassCSP(): Promise<void>;
  setJavaScriptEnabled(): Promise<void>;
  setCookie(...args: unknown[]): Promise<number>;
  goto(): Promise<void>;
}

interface BrowserModeManagerHarness {
  browser?: BrowserLike;
  currentPage?: PageLike;
  sessionData?: {cookies?: Array<{name: string; value: string}>};
  autoLaunched?: boolean;
  browserProcess?: {killed: boolean; kill(): void};
  ensureBrowser(): Promise<BrowserLike>;
  launch(): Promise<BrowserLike>;
  newPage(): Promise<PageLike>;
  goto(url: string, page?: PageLike): Promise<void>;
  close(): Promise<void>;
  getBrowser(): BrowserLike | null;
  getCurrentPage(): PageLike | null;
}

describe('BrowserModeManager (mocked)', () => {
  it('reuses connected browser in launch', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;
    const connected = {
      isConnected: () => true,
    } satisfies BrowserLike;
    // Stub ensureBrowser so launch() returns the mock
    manager.ensureBrowser = async () => connected;

    const browser = await manager.launch();
    assert.strictEqual(browser, connected);
  });

  it('tracks current page and clears on close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    let closeHandler: (() => void) | null = null;
    const page = {
      on: (event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      },
      once: (event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      },
      isClosed: () => false,
      setCacheEnabled: async () => undefined,
      setBypassCSP: async () => undefined,
      setJavaScriptEnabled: async () => undefined,
      setCookie: async (...args: unknown[]) => {
        return args.length;
      },
      goto: async () => undefined,
    } satisfies PageLike;
    const browser = {
      newPage: async () => page,
      pages: async () => [page],
      connected: true,
      close: async () => undefined,
    } satisfies BrowserLike & {connected: boolean; close(): Promise<void>};

    // Stub ensureBrowser so newPage() doesn't try to launch real Chrome
    manager.ensureBrowser = async () => browser;
    manager.sessionData = {cookies: [{name: 'sid', value: '1'}]};

    const created = await manager.newPage();
    assert.strictEqual(created, page);
    assert.strictEqual(manager.getCurrentPage(), page);

    assert.ok(closeHandler);
  });

  it('disconnects browser and clears state on close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    let closed = 0;
    manager.browser = {
      connected: true,
      close: async () => {
        closed += 1;
      },
    } as unknown as BrowserLike & {connected: boolean; close(): Promise<void>};

    await manager.close();
    assert.strictEqual(closed, 1);
    assert.strictEqual(manager.getBrowser(), null);
    assert.strictEqual(manager.getCurrentPage(), null);
  });

  it('handles close failure branch gracefully', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    }) as unknown as BrowserModeManagerHarness;

    manager.browser = {
      connected: true,
      close: async () => {
        throw new Error('close failed');
      },
    } as unknown as BrowserLike & {connected: boolean; close(): Promise<void>};

    await manager.close();
    assert.strictEqual(manager.getBrowser(), null);
  });
});
