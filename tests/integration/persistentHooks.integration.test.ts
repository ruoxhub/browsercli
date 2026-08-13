/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {after, describe, it} from 'node:test';

import {chromium, type Browser} from 'patchright';

import {PersistentHookRegistry} from '../../src/modules/hook/PersistentHookRegistry.js';

const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';

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
  'PersistentHookRegistry Chromium integration',
  {skip: !runBrowserTests},
  () => {
    let browser: Browser | undefined;

    after(async () => {
      await browser?.close();
    });

    it('persists within one context and disappears after context close', async () => {
      browser = await chromium.launch({
        headless: true,
        executablePath: await resolveChromeExecutable(),
      });
      const context = await browser.newContext();
      const existingPage = await context.newPage();
      await existingPage.goto('data:text/html,<main>existing</main>');
      const registry = new PersistentHookRegistry();
      const script =
        'globalThis.__persistentHookRuns = (globalThis.__persistentHookRuns ?? 0) + 1;';

      await registry.register({
        context,
        hookId: 'integration-hook',
        script,
        source: 'inject_hook',
        requestedWorld: 'main',
        applyMode: 'existing-and-future',
      });
      assert.equal(
        await existingPage.evaluate(() =>
          Reflect.get(globalThis, '__persistentHookRuns'),
        ),
        1,
      );

      await existingPage.reload();
      assert.equal(
        await existingPage.evaluate(() =>
          Reflect.get(globalThis, '__persistentHookRuns'),
        ),
        1,
      );

      const newPage = await context.newPage();
      await newPage.goto('data:text/html,<main>new</main>');
      assert.equal(
        await newPage.evaluate(() =>
          Reflect.get(globalThis, '__persistentHookRuns'),
        ),
        1,
      );

      await newPage.setContent('<iframe src="data:text/html,frame"></iframe>');
      const childFrame = newPage
        .frames()
        .find(frame => frame !== newPage.mainFrame());
      assert.ok(childFrame);
      await childFrame.waitForLoadState();
      assert.equal(
        await childFrame.evaluate(() =>
          Reflect.get(globalThis, '__persistentHookRuns'),
        ),
        1,
      );

      const idempotent = await registry.register({
        context,
        hookId: 'integration-hook',
        script,
        source: 'inject_hook',
        requestedWorld: 'main',
        applyMode: 'existing-and-future',
      });
      assert.equal(idempotent.idempotent, true);
      assert.equal(
        await newPage.evaluate(() =>
          Reflect.get(globalThis, '__persistentHookRuns'),
        ),
        1,
      );

      await context.close();
      assert.deepEqual(registry.list(context), []);

      const freshContext = await browser.newContext();
      try {
        const freshPage = await freshContext.newPage();
        await freshPage.goto('data:text/html,<main>fresh</main>');
        assert.equal(
          await freshPage.evaluate(() =>
            Reflect.get(globalThis, '__persistentHookRuns'),
          ),
          undefined,
        );
      } finally {
        await freshContext.close();
      }
    });
  },
);
