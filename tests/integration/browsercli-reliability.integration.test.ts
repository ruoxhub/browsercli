/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {access, readFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {WebSocketServer} from 'ws';

import {chromium, type Browser, type Page} from 'patchright';

import {ToolPrerequisiteChecker} from '../../src/tools/prerequisites/ToolPrerequisiteChecker.js';
import {ErrorCodes, ToolError} from '../../src/utils/errors.js';
import {DebuggerContextProvider} from '../../src/worker/context/DebuggerContextProvider.js';

const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';
const fixtureRoot = path.resolve('tests/fixtures/browsercli-reliability');

async function startFixtureServer(): Promise<{server: Server; url: string}> {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/api/data') {
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify({ok: true, source: 'fixture-api'}));
        return;
      }
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const content = await readFile(path.join(fixtureRoot, file));
      const extension = path.extname(file).toLowerCase();
      response.writeHead(200, {
        'content-type':
          extension === '.html'
            ? 'text/html; charset=utf-8'
            : extension === '.wasm'
              ? 'application/wasm'
              : 'text/javascript; charset=utf-8',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });

  const wss = new WebSocketServer({noServer: true});
  wss.on('connection', socket => {
    socket.on('message', data => socket.send(data));
  });
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
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
      // Try the next conventional path.
    }
  }
  return undefined;
}

async function waitFor<T>(
  predicate: () => T | undefined | boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

describe(
  'browsercli reliability (Layer 3, local fixture)',
  {skip: !runBrowserTests},
  () => {
    let server: Server;
    let browser: Browser;
    let page: Page;
    let fixtureUrl: string;
    let chromiumUnavailable = false;

    before(async () => {
      const fixture = await startFixtureServer();
      server = fixture.server;
      fixtureUrl = fixture.url;
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
          // Continue remaining cleanup.
        }
      }
    });

    it('serves the local fixture and exposes its named functions', async t => {
      if (chromiumUnavailable || !browser || !page) {
        t.skip('Chromium not available locally');
        return;
      }
      await page.goto(fixtureUrl);
      await waitFor(() => {
        try {
          return page.evaluate(
            () =>
              typeof (window as unknown as {fixtureAdd?: unknown})
                .fixtureAdd === 'function',
          );
        } catch {
          return false;
        }
      });
      const result = await page.evaluate('fixtureAdd(2, 3)');
      assert.equal(result, 5);
    });

    it('fails a running-state tool under 250ms when the debugger is paused', async t => {
      if (chromiumUnavailable || !browser || !page) {
        t.skip('Chromium not available locally');
        return;
      }
      await page.goto(fixtureUrl);
      await page.evaluate(() => {
        (
          window as unknown as {targetForBreakpoint?: (n: number) => number}
        ).targetForBreakpoint?.(5);
      });

      const provider = new DebuggerContextProvider();
      const manager = await provider.ensureForPage(page);

      // Pause the debugger without enabling any page-eval path.
      await manager.pause();
      await waitFor(() => manager.isPaused());

      const checker = new ToolPrerequisiteChecker({
        getSelectedPage: () => page,
        getExistingDebuggerContext: () => manager,
      });

      const startedAt = performance.now();
      assert.throws(
        () =>
          checker.check('heartbeat', {
            debugger: 'running',
            page: 'selected',
          }),
        (error: unknown) =>
          error instanceof ToolError &&
          error.code === ErrorCodes.DEBUGGER_PAUSED,
      );
      assert.ok(
        performance.now() - startedAt < 250,
        'paused-state fast fail must complete under 250ms',
      );

      // Fast-fail must not have resumed execution behind our back.
      assert.equal(manager.isPaused(), true);
    });

    it('resumes execution and allows a normal DOM query afterwards', async t => {
      if (chromiumUnavailable || !browser || !page) {
        t.skip('Chromium not available locally');
        return;
      }
      await page.goto(fixtureUrl);

      const provider = new DebuggerContextProvider();
      const manager = await provider.ensureForPage(page);
      await manager.pause();
      await waitFor(() => manager.isPaused());
      await manager.resume();
      await waitFor(() => !manager.isPaused());

      const heading = await page.evaluate(
        () => document.getElementById('heading')?.textContent,
      );
      assert.equal(heading, 'Reliability Fixture');
    });

    it('round-trips session storage state', async t => {
      if (chromiumUnavailable || !browser || !page) {
        t.skip('Chromium not available locally');
        return;
      }
      await page.goto(fixtureUrl);
      await waitFor(() =>
        page.evaluate(() => {
          return localStorage.getItem('fixtureKey') !== null;
        }),
      );

      const localValue = await page.evaluate(() =>
        localStorage.getItem('fixtureKey'),
      );
      assert.equal(localValue, 'local-value');

      await page.evaluate(() => {
        localStorage.setItem('fixtureKey', 'mutated');
      });
      const mutated = await page.evaluate(() =>
        localStorage.getItem('fixtureKey'),
      );
      assert.equal(mutated, 'mutated');

      await page.evaluate(() => {
        localStorage.setItem('fixtureKey', 'local-value');
      });
    });
  },
);
