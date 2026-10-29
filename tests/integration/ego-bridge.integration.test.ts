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

  /**
   * R3: never leak a bridge — it holds a real port and a real ego task space.
   *
   * This runs even when an assertion throws mid-body, and the port probe is part
   * of the teardown rather than the happy path so that a failing run still
   * produces the evidence that says whether the bridge actually died. A probe
   * decides, never `isRunning()`: that is only a launcher-alive check and has
   * read false while the port kept listening.
   */
  after(async () => {
    const port = wsEndpoint === undefined ? undefined : portOf(wsEndpoint);
    try {
      await BrowserManager.resetInstance();
      if (port !== undefined) {
        assert.equal(
          await portAccepts(port),
          false,
          'the bridge port must refuse connections after teardown',
        );
      }
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

      // 3. The firewall, from the client side. Two things must hold, and the
      //    first one is what makes the second meaningful: the bridge must expose
      //    at least one page at all (an empty list would make the loop below
      //    vacuous — "nothing visible" must not read as "firewall verified"),
      //    and every visible page must be one this test created.
      const browser = manager.getBrowser();
      assert.ok(browser, 'the manager must hold a browser');
      const visible = browser
        .contexts()
        .flatMap(context => context.pages())
        .filter(visiblePage => !visiblePage.isClosed());
      assert.ok(
        visible.length > 0,
        'the bridge must expose the page this test is about to drive',
      );
      assert.ok(
        visible.includes(page),
        'the manager page must be among the pages the bridge exposes',
      );
      for (const visiblePage of visible) {
        assert.ok(
          visiblePage === page,
          `a page this test did not create is visible through the bridge: ${visiblePage.url()}`,
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

      // 5b. The request-side firewall. `context.pages()` only proves the EVENT
      //     filter; the client can also ask, and a `Target.getTargets` reply is a
      //     response frame with no method for the event filter to inspect. Shipped
      //     tools (`list_targets`, `dump_target_scripts`) do exactly that, so the
      //     reply must already be scoped to this task space.
      const session = await page.context().newCDPSession(page);
      try {
        const listed = (await session.send('Target.getTargets' as never)) as {
          targetInfos?: Array<{targetId: string; url?: string}>;
        };
        const infos = listed.targetInfos ?? [];
        assert.ok(
          infos.length > 0,
          'the bridge must report at least the page this test drives',
        );
        for (const info of infos) {
          const url = info.url ?? '';
          assert.ok(
            url.length === 0 ||
              url === 'about:blank' ||
              url === 'chrome://new-tab-page/' ||
              url.startsWith(fixture.url),
            `a target outside this task space is enumerable through the bridge: ${url}`,
          );
        }
      } finally {
        await session.detach();
      }

      // 6. Page evaluation in the PAGE's own world.
      //
      //    `page.evaluate()` cannot do this: Patchright defaults it to an
      //    isolated context (`evaluate(pageFunction, arg, isolatedContext = true)`
      //    in patchright-core's client/page.js and client/frame.js), i.e. a
      //    utility world with its own `window`. A reverse-engineering hook has to
      //    land in the page's world, which is why this repo ships a dedicated
      //    main-world helper — so that is the path this test proves.
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
    },
  );
});
