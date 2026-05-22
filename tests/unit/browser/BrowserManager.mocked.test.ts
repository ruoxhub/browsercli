/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {beforeEach, afterEach, describe, it} from 'node:test';

import {
  BrowserManager,
  isPatchrightDetachedFrameError,
} from '../../../src/browser/index.js';
import {StealthScripts2025} from '../../../src/modules/stealth/StealthScripts2025.js';

interface ResettableStealthScripts {
  injectAll: typeof StealthScripts2025.injectAll;
}

interface BrowserLike {
  connected: boolean;
  isConnected?(): boolean;
  close(): Promise<void>;
  contexts?(): Array<{
    on(event: string, handler: unknown): void;
    pages(): unknown[];
  }>;
  on(event: string, handler: unknown): void;
}

interface BrowserManagerLike {
  browser?: BrowserLike;
  connectToRemoteBrowser(): Promise<BrowserLike>;
  detachedFrameGuard?: (error: Error) => void;
  installDetachedFrameGuard(): void;
  launchBrowser(): Promise<BrowserLike>;
  close(): Promise<void>;
  ensureBrowser(): Promise<BrowserLike>;
}

describe('BrowserManager mocked', () => {
  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(async () => {
    await BrowserManager.resetInstance();
    originalInjectAll = StealthScripts2025.injectAll;
  });

  afterEach(async () => {
    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll =
      originalInjectAll;
    try {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });
      await manager.close();
    } catch {
      // no-op
    }
    await BrowserManager.resetInstance();
  });

  it('uses connected browser directly in ensureBrowser', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    const existing = {
      connected: true,
      isConnected() {
        return this.connected;
      },
    };
    (manager as unknown as BrowserManagerLike).browser =
      existing as BrowserLike;

    const browser = await manager.ensureBrowser();
    assert.strictEqual(browser, existing);
  });

  it('selects remote connect or launch path', async () => {
    // Reset singleton between tests
    await BrowserManager.resetInstance();

    const remote = BrowserManager.getInstance({
      remoteDebuggingUrl: 'http://127.0.0.1:9222',
      headless: true,
      isolated: true,
    });
    let remoteCalled = 0;
    (remote as unknown as BrowserManagerLike).connectToRemoteBrowser =
      async () => {
        remoteCalled += 1;
        return {
          connected: true,
          close: async () => undefined,
          on: () => undefined,
        };
      };
    await remote.ensureBrowser();
    assert.strictEqual(remoteCalled, 1);

    await BrowserManager.resetInstance();

    const local = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    let launchCalled = 0;
    (local as unknown as BrowserManagerLike).launchBrowser = async () => {
      launchCalled += 1;
      return {
        connected: true,
        close: async () => undefined,
        on: () => undefined,
      };
    };
    await local.ensureBrowser();
    assert.strictEqual(launchCalled, 1);
  });

  it('injects stealth scripts once and handles new page targets', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    const pageA = {id: 'a'};
    const pageB = {id: 'b'};
    type PageHandler = (page: {id: string}) => Promise<void>;
    let onPage: PageHandler | null = null;
    const browser: BrowserLike = {
      contexts: () => [
        {
          pages: () => [pageA, pageB],
          on: (event: string, handler: unknown) => {
            if (event === 'page') {
              onPage = handler as PageHandler;
            }
          },
        },
      ],
      on: (event: string, handler: unknown) => {
        void event;
        void handler;
      },
      close: async () => undefined,
      connected: true,
    };
    (manager as unknown as BrowserManagerLike).browser = browser;

    let injectedCount = 0;
    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll =
      async () => {
        injectedCount += 1;
        return {
          preset: 'linux-chrome',
          injectedFeatures: ['mockChrome'],
          skippedFeatures: [],
          userAgent: 'mock-agent',
          platform: 'Linux x86_64',
        };
      };

    await manager.injectStealth('linux-chrome', {mockConnection: false});
    assert.strictEqual(injectedCount, 2);

    await manager.injectStealth();
    assert.strictEqual(injectedCount, 2);

    if (!onPage) {
      throw new Error('expected page handler');
    }
    const pageHandler: PageHandler = onPage;
    await pageHandler({id: 'c'});
    assert.strictEqual(injectedCount, 3);
  });

  it('handles injectStealth failures and connection helpers', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    await assert.rejects(async () => {
      await manager.injectStealth();
    }, /Browser not initialized/);

    (manager as unknown as BrowserManagerLike).browser = {
      contexts: () => [
        {
          pages: () => [{}],
          on: () => undefined,
        },
      ],
      on: () => undefined,
      close: async () => undefined,
      connected: true,
      isConnected() {
        return this.connected;
      },
    };

    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll =
      async () => {
        throw new Error('inject failed');
      };

    await assert.rejects(async () => {
      await manager.injectStealth();
    }, /Failed to inject stealth scripts: inject failed/);

    assert.strictEqual(
      manager.getStealthFeatures().includes('mockChrome'),
      true,
    );
    assert.strictEqual(manager.getStealthPresets().length > 0, true);
    assert.strictEqual(manager.isConnected(), true);
  });

  it('restarts and closes browser with cleanup', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    let closeCalled = 0;
    (manager as unknown as BrowserManagerLike).browser = {
      connected: true,
      isConnected() {
        return this.connected;
      },
      close: async () => {
        closeCalled += 1;
        throw new Error('close fail');
      },
      on: () => undefined,
    };

    await manager.close();
    assert.strictEqual(closeCalled, 1);
    assert.strictEqual(manager.isConnected(), false);

    let restarted = 0;
    (manager as unknown as BrowserManagerLike).close = async () => {
      restarted += 1;
    };
    (manager as unknown as BrowserManagerLike).ensureBrowser = async () => {
      restarted += 1;
      return {
        connected: true,
        isConnected() {
          return this.connected;
        },
        close: async () => undefined,
        on: () => undefined,
      };
    };
    await manager.restart();
    assert.strictEqual(restarted, 2);
  });

  it('classifies only Patchright detached frame errors', () => {
    const patchrightError = new Error('Frame was detached');
    patchrightError.stack =
      'Error: Frame was detached\n    at patchright-core/lib/server/chromium/crPage.js';

    const sameMessageFromApp = new Error('Frame was detached');
    sameMessageFromApp.stack = 'Error: Frame was detached\n    at src/app.ts';

    assert.strictEqual(isPatchrightDetachedFrameError(patchrightError), true);
    assert.strictEqual(
      isPatchrightDetachedFrameError(sameMessageFromApp),
      false,
    );
    assert.strictEqual(
      isPatchrightDetachedFrameError('Frame was detached'),
      false,
    );
  });

  it('installs and removes the detached frame guard with browser cleanup', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    }) as unknown as BrowserManagerLike;

    const before = process.listenerCount('uncaughtException');
    manager.installDetachedFrameGuard();
    assert.strictEqual(process.listenerCount('uncaughtException'), before + 1);

    const patchrightError = new Error('Frame was detached');
    patchrightError.stack =
      'Error: Frame was detached\n    at patchright-core/lib/server/chromium/crPage.js';
    manager.detachedFrameGuard?.(patchrightError);
    assert.strictEqual(process.listenerCount('uncaughtException'), before + 1);

    await manager.close();
    assert.strictEqual(process.listenerCount('uncaughtException'), before);
  });
});
