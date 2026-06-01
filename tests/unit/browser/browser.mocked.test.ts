/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {createWriteStream} from 'node:fs';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  BrowserManager,
  launch,
  resolveAutoConnectTarget,
} from '../../../src/browser/index.js';
import {
  StealthScripts2025,
  type StealthReport,
} from '../../../src/modules/stealth/StealthScripts2025.js';
import {chromium, firefox} from 'patchright';

interface ResettableStealthScripts {
  injectAll: typeof StealthScripts2025.injectAll;
}

interface ProcessLike {
  stderr: {pipe(destination: unknown): void};
  stdout: {pipe(destination: unknown): void};
}

interface PageLike {
  resize(): Promise<void>;
}

interface BrowserLike {
  connected: boolean;
  process?(): ProcessLike;
  pages(): Promise<unknown[]>;
  on(event: string, handler: unknown): void;
  close(): Promise<void>;
}

interface BrowserManagerLike {
  browser?: BrowserLike;
  connectToRemoteBrowser(): Promise<BrowserLike>;
  launchBrowser(): Promise<BrowserLike>;
}

type TargetCreatedHandler = (target: {
  type(): string;
  page(): Promise<{id: string}>;
}) => Promise<void>;

function makeStealthReport(preset: string): StealthReport {
  return {
    preset,
    injectedFeatures: ['mockChrome'],
    skippedFeatures: [],
    userAgent: 'mock-agent',
    platform: 'mock-platform',
  };
}

describe('browser.ts mocked', () => {
  let originalLaunch: typeof chromium.launch;
  let originalConnect: typeof chromium.connectOverCDP;
  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(async () => {
    await BrowserManager.resetInstance();
    originalLaunch = chromium.launch;
    originalConnect = chromium.connectOverCDP;
    originalInjectAll = StealthScripts2025.injectAll;
  });

  afterEach(async () => {
    chromium.launch = originalLaunch;
    chromium.connectOverCDP = originalConnect;
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

  it('launch() passes options, resizes viewport and handles already running error', async () => {
    let launchArgs: Record<string, unknown> | null = null;
    let resized = 0;
    const fakeBrowser: BrowserLike = {
      connected: true,
      process: () => ({
        stderr: {pipe: () => undefined},
        stdout: {pipe: () => undefined},
      }),
      pages: async () => [
        {
          resize: async () => {
            resized += 1;
          },
        } satisfies PageLike,
      ],
      on: () => undefined,
      close: async () => undefined,
    };

    chromium.launch = async opts => {
      launchArgs = (opts ?? {}) as Record<string, unknown>;
      return fakeBrowser as unknown as Awaited<
        ReturnType<typeof chromium.launch>
      >;
    };

    const out = await launch({
      headless: true,
      isolated: true,
      devtools: true,
      args: ['--x-test'],
      viewport: {width: 800, height: 600},
      logFile: createWriteStream('/tmp/js-reverse-mcp-browser-mocked.log'),
    });

    assert.strictEqual(
      out,
      fakeBrowser as unknown as Awaited<ReturnType<typeof chromium.launch>>,
    );
    assert.ok(launchArgs);
    assert.strictEqual(Array.isArray((launchArgs ?? {})['args']), true);
    assert.strictEqual(resized, 1);

    chromium.launch = async () => {
      throw new Error('The browser is already running');
    };
    await assert.rejects(async () => {
      await launch({
        headless: false,
        isolated: false,
        devtools: false,
        userDataDir: '/tmp/browser-profile',
      });
    }, /Use --isolated/);
  });

  it('connectToRemoteBrowser handles success and failure', async () => {
    const manager = BrowserManager.getInstance({
      remoteDebuggingUrl: 'http://127.0.0.1:9222',
      wsHeaders: {Authorization: 'x'},
      isolated: true,
      headless: true,
    });

    const browser: BrowserLike = {
      connected: true,
      on: () => undefined,
      pages: async () => [],
      close: async () => undefined,
    };
    chromium.connectOverCDP = async () =>
      browser as unknown as Awaited<ReturnType<typeof chromium.connectOverCDP>>;

    const connected = await (
      manager as unknown as BrowserManagerLike
    ).connectToRemoteBrowser();
    assert.strictEqual(connected, browser);

    chromium.connectOverCDP = async () => {
      throw new Error('refused');
    };
    await assert.rejects(async () => {
      await (manager as unknown as BrowserManagerLike).connectToRemoteBrowser();
    }, /Failed to connect to remote browser: refused/);
  });

  it('resolveAutoConnectTarget picks the first reachable devtools endpoint', async () => {
    const calls: string[] = [];
    const result = await resolveAutoConnectTarget({
      candidates: ['http://127.0.0.1:9222', 'http://127.0.0.1:9223'],
      fetchImpl: async (input: string | URL | globalThis.Request) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('9222')) {
          throw new Error('refused');
        }
        return {
          ok: true,
          json: async () => ({
            Browser: 'Chrome/133',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/abc',
          }),
        } as Response;
      },
    });

    assert.deepStrictEqual(calls, [
      'http://127.0.0.1:9222/json/version',
      'http://127.0.0.1:9223/json/version',
    ]);
    assert.deepStrictEqual(result, {
      browserURL: 'http://127.0.0.1:9223',
      wsEndpoint: 'ws://127.0.0.1:9223/devtools/browser/abc',
    });
  });

  it('launchBrowser handles success path and failure wrapping', async () => {
    const manager = BrowserManager.getInstance({
      isolated: true,
      headless: true,
      devtools: false,
      args: ['--a'],
    });

    const browser: BrowserLike = {
      connected: true,
      on: () => undefined,
      pages: async () => [],
      close: async () => undefined,
    };
    chromium.launch = async () =>
      browser as unknown as Awaited<ReturnType<typeof chromium.launch>>;
    const launched = await (
      manager as unknown as BrowserManagerLike
    ).launchBrowser();
    assert.strictEqual(launched, browser);
    assert.strictEqual(manager.isConnected(), true);

    chromium.launch = async () => {
      throw new Error('failed to spawn');
    };
    await assert.rejects(async () => {
      await (manager as unknown as BrowserManagerLike).launchBrowser();
    }, /Failed to launch browser: failed to spawn/);
  });

  it('routes moz-firefox channel to firefox.launch without Chromium-only args', async () => {
    await BrowserManager.resetInstance();
    const manager = BrowserManager.getInstance({
      channel: 'moz-firefox',
      isolated: true,
      headless: true,
      devtools: true,
      useStealthScripts: true,
      args: ['--user-flag'],
    });

    let firefoxArgs: Record<string, unknown> | null = null;
    let chromiumCalled = false;
    const originalFirefoxLaunch = firefox.launch;
    const fakeFirefoxBrowser = {
      connected: true,
      on: () => undefined,
      pages: async () => [],
      contexts: () => [] as unknown[],
      close: async () => undefined,
      isConnected: () => true,
    };
    firefox.launch = async opts => {
      firefoxArgs = (opts ?? {}) as Record<string, unknown>;
      return fakeFirefoxBrowser as unknown as Awaited<
        ReturnType<typeof firefox.launch>
      >;
    };
    const originalChromiumLaunch = chromium.launch;
    chromium.launch = async () => {
      chromiumCalled = true;
      throw new Error('chromium.launch should not be called for moz-firefox');
    };

    try {
      await (manager as unknown as BrowserManagerLike).launchBrowser();
    } finally {
      firefox.launch = originalFirefoxLaunch;
      chromium.launch = originalChromiumLaunch;
    }

    assert.strictEqual(chromiumCalled, false);
    assert.ok(firefoxArgs, 'firefox.launch should have been invoked');
    assert.strictEqual(
      (firefoxArgs as Record<string, unknown>)['channel'],
      'moz-firefox',
      'Firefox channel must pass through unchanged for prefix dispatch',
    );
    assert.strictEqual(
      'ignoreDefaultArgs' in (firefoxArgs as Record<string, unknown>),
      false,
      'ignoreDefaultArgs is Chromium-only and must not be sent to firefox.launch',
    );
    const passedArgs = (firefoxArgs as Record<string, unknown>)[
      'args'
    ] as string[];
    assert.ok(Array.isArray(passedArgs));
    assert.ok(
      passedArgs.includes('--user-flag'),
      'user-supplied args must still be forwarded',
    );
    assert.ok(
      !passedArgs.includes('--hide-crash-restore-bubble'),
      'Chromium-only flag must not leak into Firefox launch args',
    );
    assert.ok(
      !passedArgs.includes('--auto-open-devtools-for-tabs'),
      'devtools flag is Chromium-only',
    );
  });

  it('passes bidi-chrome channel through to chromium.launch unchanged', async () => {
    await BrowserManager.resetInstance();
    const manager = BrowserManager.getInstance({
      channel: 'bidi-chrome',
      isolated: true,
      headless: true,
      devtools: false,
    });

    let chromiumArgs: Record<string, unknown> | null = null;
    const fakeChromiumBrowser = {
      connected: true,
      on: () => undefined,
      pages: async () => [],
      contexts: () => [] as unknown[],
      close: async () => undefined,
      isConnected: () => true,
    };
    chromium.launch = async opts => {
      chromiumArgs = (opts ?? {}) as Record<string, unknown>;
      return fakeChromiumBrowser as unknown as Awaited<
        ReturnType<typeof chromium.launch>
      >;
    };

    await (manager as unknown as BrowserManagerLike).launchBrowser();

    assert.ok(chromiumArgs);
    assert.strictEqual(
      (chromiumArgs as Record<string, unknown>)['channel'],
      'bidi-chrome',
      'bidi-* channels must pass through verbatim so patchright dispatches to BidiChromium',
    );
  });

  it('injectStealth supports duplicate skip and targetcreated injection', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    let createdHandler: TargetCreatedHandler | null = null;
    const browser: BrowserLike = {
      connected: true,
      pages: async () => [{id: 'a'}],
      on: (event: string, handler: unknown) => {
        if (event === 'targetcreated') {
          createdHandler = handler as TargetCreatedHandler;
        }
      },
      close: async () => undefined,
    };
    (manager as unknown as BrowserManagerLike).browser = browser;

    let injectCount = 0;
    (StealthScripts2025 as unknown as ResettableStealthScripts).injectAll =
      async () => {
        injectCount += 1;
        return makeStealthReport('windows-chrome');
      };

    await manager.injectStealth('windows-chrome');
    assert.strictEqual(injectCount, 1);

    await manager.injectStealth();
    assert.strictEqual(injectCount, 1);

    if (!createdHandler) {
      throw new Error('expected targetcreated handler');
    }
    const targetCreatedHandler: TargetCreatedHandler = createdHandler;
    await targetCreatedHandler({
      type: () => 'page',
      page: async () => ({id: 'new-page'}),
    });
    assert.strictEqual(injectCount, 2);
  });
});
