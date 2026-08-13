import assert from 'node:assert';
import {access, readFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {chromium, type Browser, type Page} from 'patchright';

import {BrowserTargetInspector} from '../../src/modules/browser/BrowserTargetInspector.js';

const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';
const fixtureRoot = path.resolve('tests/fixtures/browser-targets');

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

describe(
  'BrowserTargetInspector Chromium integration',
  {skip: !runBrowserTests},
  () => {
    let server: Server;
    let browser: Browser;
    let page: Page;
    let inspector: BrowserTargetInspector;
    let fixtureUrl: string;

    before(async () => {
      const fixture = await startFixtureServer();
      server = fixture.server;
      fixtureUrl = fixture.url;
      browser = await chromium.launch({
        headless: true,
        executablePath: await resolveChromeExecutable(),
      });
      page = await browser.newPage();
      await page.goto(fixture.url);
      await page.evaluate(async () => {
        const targetWindow = window as typeof window & {
          workerReady: Promise<void>;
          blobWorkerReady: Promise<void>;
          sharedWorkerReady: Promise<void>;
          serviceWorkerReady: Promise<void>;
        };
        await Promise.all([
          targetWindow.workerReady,
          targetWindow.blobWorkerReady,
          targetWindow.sharedWorkerReady,
          targetWindow.serviceWorkerReady,
        ]);
      });
      inspector = new BrowserTargetInspector(() => browser);
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
    });

    it('dumps pre-existing ordinary, blob, shared, and service worker scripts', async () => {
      const targets = await inspector.listTargets();
      for (const type of ['worker', 'shared_worker', 'service_worker']) {
        assert.ok(
          targets.some(target => target.type === type),
          `missing ${type}`,
        );
      }

      const markerByType: Record<string, string> = {
        worker: '__ordinaryWorkerMarker',
        shared_worker: '__sharedWorkerMarker',
        service_worker: '__serviceWorkerMarker',
      };
      for (const [type, marker] of Object.entries(markerByType)) {
        const expectedUrl =
          type === 'worker'
            ? `${fixtureUrl}/worker.js`
            : type === 'shared_worker'
              ? `${fixtureUrl}/shared-worker.js`
              : `${fixtureUrl}/service-worker.js`;
        const target = targets.find(
          item => item.type === type && item.url === expectedUrl,
        );
        assert.ok(target);
        const dump = await inspector.dumpScripts(target.targetId);
        assert.ok(
          dump.scripts.some(script => script.content.includes(marker)),
          `${type} marker missing; urls=${dump.scripts.map(script => script.url).join(',')}; failures=${dump.failures.map(failure => failure.reason).join(',')}`,
        );
        if (type === 'worker') {
          assert.ok(
            dump.scripts.some(script =>
              script.content.includes('__nestedWorkerMarker'),
            ),
          );
        }
      }

      const blobTarget = targets.find(
        target => target.type === 'worker' && target.url.startsWith('blob:'),
      );
      assert.ok(blobTarget);
      const blobDump = await inspector.dumpScripts(blobTarget.targetId);
      assert.ok(
        blobDump.scripts.some(script =>
          script.content.includes('__blobWorkerMarker'),
        ),
      );
      assert.ok(
        blobDump.scripts.some(
          script =>
            script.url.startsWith('blob:') ||
            script.url.startsWith('target://'),
        ),
      );
    });

    it('uses a fresh temporary attachment after each completed dump', async () => {
      const target = (await inspector.listTargets()).find(
        item => item.type === 'worker' && !item.url.startsWith('blob:'),
      );
      assert.ok(target);
      assert.notStrictEqual(
        await inspector.dumpScripts(target.targetId),
        await inspector.dumpScripts(target.targetId),
      );
    });
  },
);
