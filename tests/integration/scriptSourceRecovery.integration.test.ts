/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {access, readFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {chromium, type Browser, type Page} from 'patchright';

import type {DebuggerManager} from '../../src/modules/debugger/DebuggerManager.js';
import type {ScriptInfo} from '../../src/modules/debugger/ScriptManager.js';
import {getScriptSource} from '../../src/tools/debugger/index.js';
import {DebuggerContextProvider} from '../../src/worker/context/DebuggerContextProvider.js';

const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';
const fixtureRoot = path.resolve('tests/fixtures/script-source-recovery');
const PAGE_ID = 'recovery-test-page';

async function startFixtureServer(): Promise<{server: Server; url: string}> {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const content = await readFile(path.join(fixtureRoot, file));
      response.writeHead(200, {
        'content-type': file.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'text/javascript; charset=utf-8',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {server, url: `http://127.0.0.1:${address.port}`};
}

async function resolveChromeExecutable(): Promise<string | undefined> {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional path, then fall back to bundled Chromium.
    }
  }
  return undefined;
}

async function waitFor<T>(
  predicate: () => T | undefined,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = predicate();
    if (result !== undefined) return result;
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

interface ToolResult {
  success: boolean;
  message: string;
  data: {
    scriptId: string;
    sourcePath: string;
    sourceLength: number;
    sha256: string;
    matchedBy?: string;
    staleScriptIdRecovered?: boolean;
    locator?: {
      pageId?: string;
      url: string | null;
      sourceLength: number;
      contentHash: string;
    };
  };
}

/**
 * 以真实 get_script_source 工具的形式调用，上下文复用工具 Context 的页面
 * 解析能力（getSelectedPage / getPageId / resolvePage），以覆盖 locator 的
 * pageId 生成与存在性校验路径。
 */
async function callGetScriptSource(
  manager: DebuggerManager,
  page: Page,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  let content: ToolResult | undefined;
  const response = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    appendResponseLine: () => {},
    setStructuredContent: (value: unknown) => {
      content = value as ToolResult;
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludePages: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeNetworkRequests: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeConsoleData: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachImage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachNetworkRequest: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachConsoleMessage: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    setIncludeWebSocketConnections: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- required stub
    attachWebSocket: () => {},
  };
  const context = {
    getDebuggerContext: async () => manager,
    getSelectedPage: () => page,
    getPageId: () => PAGE_ID,
    resolvePage: (selector: {pageId?: string}) => {
      if (selector.pageId !== undefined && selector.pageId !== PAGE_ID) {
        throw new Error(`页面 ${selector.pageId} 已关闭或不存在`);
      }
      return {page, pageId: PAGE_ID, pageIdx: 0};
    },
  };
  await getScriptSource.handler(
    {params} as never,
    response as never,
    context as never,
  );
  assert.ok(content, 'get_script_source 未返回结构化内容');
  return content!;
}

describe(
  'script source recovery across reload (Chromium)',
  {skip: !runBrowserTests},
  () => {
    let server: Server;
    let browser: Browser;
    let page: Page;
    let fixtureUrl: string;
    let tmpDir: string;
    let chromiumUnavailable = false;

    before(async () => {
      const fixture = await startFixtureServer();
      server = fixture.server;
      fixtureUrl = fixture.url;
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'script-recovery-'));
      try {
        browser = await chromium.launch({
          headless: true,
          executablePath: await resolveChromeExecutable(),
        });
        page = await browser.newPage();
      } catch {
        chromiumUnavailable = true;
      }
    });

    after(async () => {
      for (const cleanup of [
        () => page?.close(),
        () => browser?.close(),
        () => new Promise<void>(resolve => server?.close(() => resolve())),
      ]) {
        try {
          await cleanup();
        } catch {
          // Continue the remaining cleanup steps.
        }
      }
      rmSync(tmpDir, {recursive: true, force: true});
    });

    it('recovers the same source by locator after a reload reassigns scriptId', async t => {
      if (chromiumUnavailable || !browser || !page) {
        t.skip('Chromium not available locally');
        return;
      }

      await page.goto(fixtureUrl);

      // 会话 1：挂载真实 DebuggerManager 到页面 CDP session。
      const provider = new DebuggerContextProvider();
      const manager = await provider.ensureForPage(page);
      const app = await waitFor<ScriptInfo>(() =>
        manager
          .getScripts()
          .find(script => script.url === `${fixtureUrl}/app.js`),
      );

      // 第一次解析：记录 locator 与 sha256。
      const first = await callGetScriptSource(manager, page, {
        scriptId: app.scriptId,
        filePath: path.join(tmpDir, 'first-app.js'),
      });
      assert.equal(first.success, true);
      const locator = first.data.locator;
      assert.ok(locator, '首次解析应返回可复用的 locator');
      assert.equal(locator!.pageId, PAGE_ID);
      assert.equal(locator!.contentHash, first.data.sha256);

      // 刷新页面，CDP 会为同一脚本重新分配 scriptId。复用同一个
      // DebuggerManager（同会话）：旧 scriptId 条目仍残留在 getScripts() 中，
      // 与新条目 url + 内容完全一致，必须等待新条目出现。
      await page.reload();
      await waitFor<ScriptInfo>(() =>
        manager
          .getScripts()
          .find(
            script =>
              script.url === `${fixtureUrl}/app.js` &&
              script.scriptId !== app.scriptId,
          ),
      );

      // 用旧 locator（pageId + url + contentHash）恢复脚本，断言 hash 稳定。
      const recovered = await callGetScriptSource(manager, page, {
        locator,
        filePath: path.join(tmpDir, 'recovered-app.js'),
      });
      assert.equal(recovered.success, true);
      assert.equal(recovered.data.sha256, first.data.sha256);
      assert.equal(recovered.data.matchedBy, 'hash');

      // 关键断言：刷新后 scriptId 可以不同，但返回源码 hash 相同。
      assert.notEqual(
        recovered.data.scriptId,
        app.scriptId,
        'reload 后 CDP 应重新分配 scriptId，locator 恢复出新的 scriptId',
      );
    });
  },
);
