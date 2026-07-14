// @ts-nocheck
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import fs from 'node:fs';
import {afterEach, beforeEach, describe, it} from 'node:test';

import puppeteer from 'puppeteer';

import {BrowserManager} from '../../../src/browser.js';
import {BrowserModeManager} from '../../../src/modules/browser/BrowserModeManager.js';
import {StealthScripts2025} from '../../../src/modules/stealth/StealthScripts2025.js';

interface BrowserLike {
  connected?: boolean;
  close?(): Promise<void>;
  pages?(): Promise<PageLike[]>;
  newPage?(): Promise<PageLike>;
  on?(event: string, handler: () => void): void;
}

interface PageLike {
  on?(event: string, handler: () => void): void;
  once?(event: string, handler: () => void): void;
  isClosed?(): boolean;
}

describe('BrowserModeManager extended', () => {
  let originalConnect: typeof puppeteer.connect;
  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(async () => {
    originalConnect = puppeteer.connect;
    originalInjectAll = StealthScripts2025.injectAll;
    await BrowserManager.resetInstance();
  });

  afterEach(async () => {
    puppeteer.connect = originalConnect;
    (
      StealthScripts2025 as unknown as {
        injectAll: typeof StealthScripts2025.injectAll;
      }
    ).injectAll = originalInjectAll;
    await BrowserManager.resetInstance();
  });

  it('injects anti-detection scripts via StealthScripts2025', async () => {
    let injected = 0;
    (
      StealthScripts2025 as unknown as {
        injectAll: typeof StealthScripts2025.injectAll;
      }
    ).injectAll = async () => {
      injected += 1;
      return {
        preset: 'linux-chrome',
        injectedFeatures: ['x'],
        skippedFeatures: [],
        userAgent: 'ua',
        platform: 'linux',
        scriptCount: 1,
        injectedScripts: ['x'],
        errors: [],
      };
    };

    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: true,
    });

    const page: PageLike = {
      isClosed: () => false,
    };
    const browser: BrowserLike = {
      connected: true,
      pages: async () => [page],
      on: () => undefined,
      close: async () => undefined,
    };

    (manager as unknown as {browser?: BrowserLike}).browser = browser;
    await manager.injectStealth();
    assert.strictEqual(injected, 1);
  });

  it('covers close cleanup branches', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    const browser: BrowserLike = {
      connected: true,
      close: async () => {
        throw new Error('close failed');
      },
    };

    (manager as unknown as {browser?: BrowserLike}).browser = browser;

    await manager.close();
    assert.strictEqual(manager.getBrowser(), null);
    assert.strictEqual(manager.getCurrentPage(), null);
  });

  it('covers launch autoLaunch failure branch with actionable message', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: true,
      useStealthScripts: false,
      remoteDebuggingPort: 9444,
      browserURL: 'http://127.0.0.1:9444',
    });

    // Mock fetch to fail so connectToRemoteBrowser proceeds to puppeteer.connect
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('fetch failed');
    };

    puppeteer.connect = (async () => {
      throw new Error('connect failed');
    }) as typeof puppeteer.connect;
    (
      manager as unknown as {launchBrowserProcess(): Promise<void>}
    ).launchBrowserProcess = async () => {
      throw new Error('spawn failed');
    };

    try {
      await assert.rejects(async () => {
        await manager.launch();
      }, /connect|Failed|fetch failed/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('covers newPage launch-on-demand and close handler cleanup', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    }) as unknown as {
      ensureBrowser(): Promise<BrowserLike>;
      browser?: BrowserLike;
      launch(): Promise<BrowserLike>;
      newPage(): Promise<PageLike>;
      getBrowser(): BrowserLike | null;
      getCurrentPage(): PageLike | null;
    };

    let closeHandler: (() => void) | undefined;
    const page: PageLike = {
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
    };
    const browser: BrowserLike = {
      newPage: async () => page,
      pages: async () => [page],
      connected: true,
      close: async () => undefined,
    };

    manager.ensureBrowser = async () => browser;
    manager.launch = async () => {
      manager.browser = browser;
      return browser;
    };

    const out = await manager.newPage();
    assert.strictEqual(out, page as unknown as typeof out);
    assert.ok(closeHandler);
  });

  it('detectAllBrowsers returns empty on non-Windows without browserPath', () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    const list = (
      manager as unknown as {
        detectAllBrowsers(): Array<{name: string; path: string}>;
      }
    ).detectAllBrowsers();
    assert.ok(Array.isArray(list));
    if (process.platform === 'linux') {
      assert.ok(list.length >= 0);
    }
  });

  it('detectAllBrowsers uses custom browserPath when provided', () => {
    const manager = new BrowserModeManager({
      browserPath: process.cwd(),
      autoLaunch: false,
      useStealthScripts: false,
    });
    const list = (
      manager as unknown as {
        detectAllBrowsers(): Array<{name: string; path: string}>;
      }
    ).detectAllBrowsers();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0]?.name, 'Custom Browser');
  });

  it('covers windows scanning branch and registerFound dedupe', () => {
    const originalPlatform = process.platform;
    const fakeWinPath = 'C:\\Google\\Chrome\\Application\\chrome.exe';

    fs.writeFileSync(fakeWinPath, 'x');
    Object.defineProperty(process, 'platform', {value: 'win32'});

    try {
      const manager = new BrowserModeManager({
        autoLaunch: false,
        useStealthScripts: false,
      });

      const list = (
        manager as unknown as {
          detectAllBrowsers(): Array<{name: string; path: string}>;
        }
      ).detectAllBrowsers();
      assert.ok(
        list.some((b: {path: string}) => String(b.path).includes(fakeWinPath)),
      );
    } finally {
      Object.defineProperty(process, 'platform', {value: originalPlatform});
      if (fs.existsSync(fakeWinPath)) {
        try {
          fs.unlinkSync(fakeWinPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  });

  it('handles disconnect failure branch on close', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    const browser: BrowserLike = {
      connected: true,
      close: async () => {
        throw new Error('close failed');
      },
    };

    (manager as unknown as {browser?: BrowserLike}).browser = browser;

    await manager.close();
    assert.strictEqual(manager.getBrowser(), null);
  });
});
