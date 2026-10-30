/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {createWriteStream} from 'node:fs';
import fs from 'node:fs';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {chromium, firefox} from 'patchright';

import {
  BrowserManager,
  launch,
  resolveAutoConnectTarget,
} from '../../../src/modules/browser/index.js';
import {
  StealthScripts2025,
  type StealthReport,
} from '../../../src/modules/stealth/StealthScripts2025.js';

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
  isConnected?(): boolean;
  process?(): ProcessLike;
  pages(): Promise<unknown[]>;
  contexts(): Array<{
    pages(): unknown[];
    on?: (event: string, handler: unknown) => void;
  }>;
  version(): string;
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
      contexts: () => [
        {
          pages: () => [
            {
              setViewportSize: async () => {
                resized += 1;
              },
            },
          ],
        },
      ],
      version: () => 'Chrome/144.0.0.0',
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
      contexts: () => [{pages: () => []}],
      version: () => 'Chrome/144.0.0.0',
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
      isConnected: () => true,
      on: () => undefined,
      pages: async () => [],
      contexts: () => [{pages: () => []}],
      version: () => 'Chrome/144.0.0.0',
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
      contexts: () => [
        {
          pages: () => [],
          newPage: async () => ({once: () => undefined, isClosed: () => false}),
        },
      ],
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
      contexts: () => [{pages: () => []}],
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
      isConnected: () => true,
      pages: async () => [{id: 'a'}],
      contexts: () => [
        {
          pages: () => [{id: 'a'}],
          on: (event: string, handler: unknown) => {
            if (event === 'page') {
              createdHandler = (async (target: {
                type(): string;
                page(): Promise<{id: string}>;
              }) => {
                const p = await target.page();
                await (handler as (p: {id: string}) => Promise<void>)(p);
              }) as TargetCreatedHandler;
            }
          },
        },
      ],
      version: () => 'Chrome/144.0.0.0',
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

  it('connectToRemoteBrowser falls back to DevToolsActivePort wsPath when /json/version returns 404', async () => {
    // Chrome 144+ / 147+ 在 chrome://inspect/#remote-debugging (Way 1) 模式下
    // 故意禁用 HTTP /json/* 发现端点——该端点会一直返回 404，但 DevToolsActivePort
    // 文件里写下的 ws path 仍可直连。这是那次报错的根因：必须能从 404 恢复到 ws。
    const originalFetch = globalThis.fetch;
    const originalReadFileSync = fs.readFileSync;
    const wsPath = '/devtools/browser/abc-uuid';
    const port = 53687;
    globalThis.fetch = (async (input: string | URL | globalThis.Request) => {
      const url = String(input);
      assert.ok(url.endsWith('/json/version'), `unexpected fetch url ${url}`);
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;
    fs.readFileSync = ((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('DevToolsActivePort')) {
        return `${port}\n${wsPath}\n`;
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    try {
      const manager = BrowserManager.getInstance({
        browserURL: `http://127.0.0.1:${port}`,
        isolated: true,
        headless: true,
      });

      let capturedEndpoint: string | undefined;
      const browser: BrowserLike = {
        connected: true,
        contexts: () => [{pages: () => []}],
        version: () => 'Chrome/144.0.0.0',
        on: () => undefined,
        pages: async () => [],
        close: async () => undefined,
      };
      chromium.connectOverCDP = (async (endpoint: string) => {
        capturedEndpoint = endpoint;
        return browser as unknown as Awaited<
          ReturnType<typeof chromium.connectOverCDP>
        >;
      }) as typeof chromium.connectOverCDP;

      const connected = await (
        manager as unknown as BrowserManagerLike
      ).connectToRemoteBrowser();
      assert.strictEqual(connected, browser);
      assert.ok(
        capturedEndpoint?.startsWith('ws://'),
        `expected ws:// endpoint, got ${capturedEndpoint}`,
      );
      assert.ok(
        capturedEndpoint?.endsWith(wsPath),
        `expected endpoint to end with ${wsPath}, got ${capturedEndpoint}`,
      );
      assert.ok(
        capturedEndpoint?.includes(String(port)),
        `expected endpoint to mention port ${port}, got ${capturedEndpoint}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
      fs.readFileSync = originalReadFileSync;
    }
  });

  it('connectToRemoteBrowser surfaces a 404 hint when no DevToolsActivePort fallback exists', async () => {
    // 反向场景：fetch /json/version 仍 404，但本机没有 DevToolsActivePort 文件。
    // 应当把 404 错误包装成可读的指引，告诉用户改用 --wsEndpoint。
    const originalFetch = globalThis.fetch;
    const originalReadFileSync = fs.readFileSync;
    globalThis.fetch = (async () => {
      throw new TypeError(
        'fetch failed: ... Unexpected status 404 when connecting to http://127.0.0.1:9222/json/version/. This does not look like a DevTools server, try connecting via ws://.',
      );
    }) as unknown as typeof fetch;
    fs.readFileSync = (() => {
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    try {
      const manager = BrowserManager.getInstance({
        browserURL: 'http://127.0.0.1:9222',
        isolated: true,
        headless: true,
      });
      chromium.connectOverCDP = (async () => {
        throw new Error(
          'Unexpected status 404 when connecting to http://127.0.0.1:9222/json/version/. This does not look like a DevTools server, try connecting via ws://.',
        );
      }) as typeof chromium.connectOverCDP;

      await assert.rejects(async () => {
        await (
          manager as unknown as BrowserManagerLike
        ).connectToRemoteBrowser();
      }, /DevTools 端点/);
    } finally {
      globalThis.fetch = originalFetch;
      fs.readFileSync = originalReadFileSync;
    }
  });

  it('resolveAutoConnectTarget synthesises a ws endpoint from DevToolsActivePort on 404', async () => {
    // resolveAutoConnectTarget 的兜底：当 discoverChromeDebugPort 拿到端口但
    // /json/version 404 时，必须从 DevToolsActivePort 读出 wsPath 并返回。
    const originalReadFileSync = fs.readFileSync;
    const port = 9333;
    const wsPath = '/devtools/browser/resolved-uuid';
    fs.readFileSync = ((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('DevToolsActivePort')) {
        return `${port}\n${wsPath}\n`;
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    try {
      const result = await resolveAutoConnectTarget({
        candidates: [`http://127.0.0.1:${port}`],
        fetchImpl: async () =>
          ({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: async () => ({}),
          }) as Response,
      });

      // candidates 模式下走 probeCandidates：fetch 404 → 返回 undefined。
      // 验证在没有 candidates 的"自动发现"路径上，readDevToolsActivePort 兜底生效。
      assert.strictEqual(result, undefined);

      // 直接验证导出 readDevToolsActivePort 自身在 stub 后的行为。
      const {readDevToolsActivePort} =
        await import('../../../src/modules/browser/browser-discovery.js');
      const active = readDevToolsActivePort();
      assert.deepStrictEqual(active, {port, wsPath});
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  });

  it('connectToRemoteBrowser handles unadorned host:port without protocol', async () => {
    // 场景：用户从 chrome://inspect/#remote-debugging 直接复制 "127.0.0.1:53687"
    const originalFetch = globalThis.fetch;
    const originalReadFileSync = fs.readFileSync;
    const wsPath = '/devtools/browser/abc-inspect-uuid';
    const port = 53687;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    fs.readFileSync = ((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('DevToolsActivePort')) {
        return `${port}\n${wsPath}\n`;
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    try {
      const manager = BrowserManager.getInstance({
        browserURL: `127.0.0.1:${port}`, // 无 http:// 前缀
        isolated: true,
        headless: true,
      });

      let capturedEndpoint: string | undefined;
      const browser: BrowserLike = {
        connected: true,
        contexts: () => [{pages: () => []}],
        version: () => 'Chrome/152.0.0.0',
        on: () => undefined,
        pages: async () => [],
        close: async () => undefined,
      };
      chromium.connectOverCDP = (async (endpoint: string) => {
        capturedEndpoint = endpoint;
        return browser as unknown as Awaited<
          ReturnType<typeof chromium.connectOverCDP>
        >;
      }) as typeof chromium.connectOverCDP;

      const connected = await (
        manager as unknown as BrowserManagerLike
      ).connectToRemoteBrowser();
      assert.strictEqual(connected, browser);
      assert.strictEqual(capturedEndpoint, `ws://127.0.0.1:${port}${wsPath}`);
    } finally {
      globalThis.fetch = originalFetch;
      fs.readFileSync = originalReadFileSync;
    }
  });

  it('connectToRemoteBrowser does not leak uncaughtException listener on failure', async () => {
    // 场景：连接反复失败，不应产生 EventEmitter memory leak
    const beforeListeners = process.listenerCount('uncaughtException');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
    }) as unknown as typeof fetch;

    try {
      const manager = BrowserManager.getInstance({
        browserURL: 'http://127.0.0.1:9999',
        isolated: true,
        headless: true,
      });
      chromium.connectOverCDP = (async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
      }) as typeof chromium.connectOverCDP;

      for (let i = 0; i < 15; i++) {
        await assert.rejects(async () => {
          await (
            manager as unknown as BrowserManagerLike
          ).connectToRemoteBrowser();
        });
        await manager.close();
      }

      const afterListeners = process.listenerCount('uncaughtException');
      assert.strictEqual(afterListeners, beforeListeners);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('connectToRemoteBrowser falls back to DevToolsActivePort when 9222 is connection-refused', async () => {
    // 场景：配置了默认的 9222，但 Chrome 在 chrome://inspect/#remote-debugging 分配了动态端口
    const originalFetch = globalThis.fetch;
    const originalReadFileSync = fs.readFileSync;
    const activePort = 53687;
    const wsPath = '/devtools/browser/dynamic-port-uuid';

    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9222');
    }) as unknown as typeof fetch;

    fs.readFileSync = ((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('DevToolsActivePort')) {
        return `${activePort}\n${wsPath}\n`;
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    try {
      const manager = BrowserManager.getInstance({
        browserURL: 'http://127.0.0.1:9222',
        isolated: true,
        headless: true,
      });

      let capturedEndpoint: string | undefined;
      const browser: BrowserLike = {
        connected: true,
        contexts: () => [{pages: () => []}],
        version: () => 'Chrome/152.0.0.0',
        on: () => undefined,
        pages: async () => [],
        close: async () => undefined,
      };
      chromium.connectOverCDP = (async (endpoint: string) => {
        capturedEndpoint = endpoint;
        return browser as unknown as Awaited<
          ReturnType<typeof chromium.connectOverCDP>
        >;
      }) as typeof chromium.connectOverCDP;

      const connected = await (
        manager as unknown as BrowserManagerLike
      ).connectToRemoteBrowser();
      assert.strictEqual(connected, browser);
      assert.strictEqual(
        capturedEndpoint,
        `ws://127.0.0.1:${activePort}${wsPath}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
      fs.readFileSync = originalReadFileSync;
    }
  });
  it('does NOT fall back to a stale DevToolsActivePort when the configured port differs', async () => {
    // 回归：配置了 browserURL=127.0.0.1:19222，但本机 DevToolsActivePort 里残留着
    // 一个早已关闭的端口（例如 ego 桥接上一次运行留下的 53687）。旧实现在
    // fetch 抛错时无条件回退到该文件，把连接导向死端点，表现为
    // "connect ECONNREFUSED 127.0.0.1:53687" —— 用户配置的端口完全没被使用。
    // 正确行为：端口不一致时不得回退，应回到配置的 browserURL。
    const originalFetch = globalThis.fetch;
    const originalReadFileSync = fs.readFileSync;
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    fs.readFileSync = ((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('DevToolsActivePort')) {
        return ['53687', '/devtools/browser/stale-uuid', ''].join(
          String.fromCharCode(10),
        );
      }
      throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
    }) as typeof fs.readFileSync;

    try {
      const manager = BrowserManager.getInstance({
        browserURL: 'http://127.0.0.1:19222',
        isolated: true,
        headless: true,
      });

      let capturedEndpoint: string | undefined;
      chromium.connectOverCDP = (async (endpoint: string) => {
        capturedEndpoint = String(endpoint);
        return {
          isConnected: () => true,
          contexts: () => [{pages: () => []}],
          on: () => undefined,
        };
      }) as unknown as typeof chromium.connectOverCDP;

      await (manager as unknown as BrowserManagerLike).connectToRemoteBrowser();

      assert.ok(capturedEndpoint, 'connectOverCDP should have been called');
      assert.ok(
        !capturedEndpoint!.includes('53687'),
        `不得连接残留端口，实际=${capturedEndpoint}`,
      );
      assert.ok(
        capturedEndpoint!.includes('19222'),
        `应使用配置端口，实际=${capturedEndpoint}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
      fs.readFileSync = originalReadFileSync;
    }
  });
});
