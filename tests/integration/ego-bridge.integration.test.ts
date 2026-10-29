/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * End-to-end check for the ego bridge: a real reverse-engineering workflow
 * driven through `BrowserManager` against the *real* installed ego lite.
 *
 * The unit tests drive a fake ego binding and a fake CLI, and the live smoke
 * test only proves the bridge serves a CDP endpoint. Neither can catch an
 * integration break in the path this feature exists for — connect through the
 * product's own manager, navigate, interact, evaluate page script, hook a page
 * function, and confirm the user's own tabs stayed out of reach.
 *
 * Nothing here is stubbed: `config.ego` makes `EgoBridgeManager` spawn the
 * installed ego CLI and publish a real `ws://127.0.0.1:<port>` endpoint that
 * Patchright attaches to. It skips cleanly when ego lite is not installed, so
 * CI on a machine without it stays green.
 */

import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import net from 'node:net';
import {after, before, describe, it} from 'node:test';

import {findEgoBrowserBinary} from '../../src/modules/browser/ego/ego-detect.js';
import {BrowserManager} from '../../src/modules/browser/index.js';
import {evaluateInPageRuntime} from '../../src/modules/debugger/evaluateInPageRuntime.js';

/**
 * Every wait in this file is bounded: a bridge that comes up but cannot serve
 * must fail in seconds instead of hanging the suite.
 */
const READY_TIMEOUT_MS = 20_000;
const STEP_TIMEOUT_MS = 10_000;

/** A real TCP connect attempt: `true` when something accepts on the port. */
function portAccepts(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const done = (accepts: boolean) => {
      socket.destroy();
      resolve(accepts);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function portOf(wsEndpoint: string): number {
  return Number(new URL(wsEndpoint).port);
}

/**
 * A page with one element to drive, one global worth hooking, and one local
 * fetch the network path can observe. `computeSign` is deliberately reachable
 * as a global so the hook can wrap it without depending on bundler internals.
 */
const FIXTURE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>ego bridge fixture</title></head>
  <body>
    <input id="seed" value="">
    <button id="run">Run</button>
    <div id="out"></div>
    <script>
      window.computeSign = function computeSign(value) {
        var digits = String(value).split('');
        var sum = 0;
        for (var i = 0; i < digits.length; i++) sum += Number(digits[i]) || 0;
        return sum * 7;
      };
      document.getElementById('run').addEventListener('click', function () {
        document.getElementById('out').textContent = String(
          window.computeSign(document.getElementById('seed').value),
        );
      });
    </script>
  </body>
</html>`;

async function startFixtureServer(): Promise<{server: Server; url: string}> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/api/data') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({ok: true, source: 'fixture-api'}));
      return;
    }
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(FIXTURE_HTML);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'fixture server must bind');
  return {server, url: `http://127.0.0.1:${address.port}/`};
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

const binary = findEgoBrowserBinary();

describe('ego bridge end-to-end integration', () => {
  let fixture: {server: Server; url: string};
  let manager: BrowserManager;
  let wsEndpoint: string | undefined;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    // R3: never leak a bridge — it holds a real port and a real ego task space.
    try {
      await BrowserManager.resetInstance();
    } finally {
      wsEndpoint = undefined;
      if (fixture?.server) await closeServer(fixture.server);
    }
  });

  it(
    'runs a reverse-engineering workflow through the manager',
    {
      skip:
        binary === null ? 'ego lite is not installed on this machine' : false,
      timeout: 120_000,
    },
    async () => {
      assert.ok(binary, 'the skip guard should have caught a missing install');

      // 1. Connect through the product path — no stubbed bridge, no stubbed CDP.
      manager = BrowserManager.getInstance({ego: true});
      await manager.ensureBrowser();
      assert.equal(manager.isConnected(), true, 'manager must be connected');

      wsEndpoint = manager.getConfig().wsEndpoint;
      assert.ok(wsEndpoint, 'the bridge must publish a CDP endpoint');
      assert.match(
        wsEndpoint,
        /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//,
        'the bridge endpoint must be loopback-only',
      );
      assert.equal(
        await portAccepts(portOf(wsEndpoint)),
        true,
        'the published endpoint must be listening',
      );

      // 2. The manager must be bound to a page the bridge exposed. An empty ego
      //    task space leaves `currentPage` null, in which case we create one.
      const page = manager.getCurrentPage() ?? (await manager.newPage());
      assert.ok(page, 'the manager must expose a page');

      // 3. The firewall, from the client side: everything visible belongs to the
      //    bridge's own task space. Anything else would be a user tab leaking in.
      //    The bridge's own new tab starts on ego's internal new-tab page, which
      //    is ours; a user's tab would be an `http(s)://` URL we never opened.
      const browser = manager.getBrowser();
      assert.ok(browser, 'the manager must hold a browser');
      const visibleUrls = browser
        .contexts()
        .flatMap(context => context.pages())
        .map(visible => visible.url());
      for (const url of visibleUrls) {
        assert.ok(
          url === 'about:blank' ||
            url === 'chrome://new-tab-page/' ||
            url.startsWith(fixture.url),
          `unexpected page visible through the bridge: ${url}`,
        );
      }

      // 4. Navigate and wait for a real readiness condition, never a sleep.
      await page.goto(fixture.url, {
        waitUntil: 'domcontentloaded',
        timeout: READY_TIMEOUT_MS,
      });
      await page.waitForSelector('#run', {
        state: 'visible',
        timeout: STEP_TIMEOUT_MS,
      });

      // 5. Interaction: drive the page and observe a DOM change.
      await page.fill('#seed', '123');
      await page.click('#run');
      await page.waitForFunction(
        () => document.getElementById('out')?.textContent === '42',
        undefined,
        {timeout: STEP_TIMEOUT_MS},
      );
      assert.equal(
        await page.evaluate(() => document.getElementById('out')?.textContent),
        '42',
        'clicking must compute 1+2+3 then multiply by 7',
      );

      // 6. Page evaluation in the PAGE's own world. `page.evaluate()` runs in
      //    Patchright's utility world, which is isolated from the page — that is
      //    Playwright's design, not the bridge's, and it is why this repo has a
      //    dedicated main-world helper. Reverse-engineering work needs the page
      //    world, so that is what this test proves here.
      const frame = page.mainFrame();
      const direct = await evaluateInPageRuntime<number>(
        frame,
        'window.computeSign("45")',
      );
      assert.equal(direct, 63, 'main-world evaluate must run page script');

      // 7. Hook injection into the PAGE's world and proof it captured a real
      //    invocation. This is the capability the bridge exists to enable.
      await evaluateInPageRuntime<void>(
        frame,
        `(() => {
           window.__hookCalls = [];
           const original = window.computeSign;
           window.computeSign = function hooked(value) {
             window.__hookCalls.push(String(value));
             return original(value);
           };
         })()`,
      );
      await page.fill('#seed', '7');
      await page.click('#run');
      await page.waitForFunction(
        () => document.getElementById('out')?.textContent === '49',
        undefined,
        {timeout: STEP_TIMEOUT_MS},
      );
      const hooked = await evaluateInPageRuntime<string[]>(
        frame,
        'window.__hookCalls',
      );
      assert.deepEqual(
        hooked,
        ['7'],
        'the injected hook must record the real argument',
      );

      // 8. The local fetch is observable end to end (network path is live).
      const payload = await evaluateInPageRuntime<{
        ok: boolean;
        source: string;
      }>(frame, 'fetch("/api/data").then(r => r.json())');
      assert.deepEqual(
        {ok: payload.ok, source: payload.source},
        {ok: true, source: 'fixture-api'},
      );

      // 9. Teardown must actually take the bridge down. A TCP probe decides —
      //    `isRunning()` is only a launcher-alive probe and can read false while
      //    the port still listens (see EgoBridgeManager's doc block).
      const endpoint = wsEndpoint;
      const port = portOf(endpoint);
      await BrowserManager.resetInstance();
      manager = undefined as unknown as BrowserManager;
      wsEndpoint = undefined;
      assert.equal(
        await portAccepts(port),
        false,
        'the bridge port must refuse connections after teardown',
      );
    },
  );
});
