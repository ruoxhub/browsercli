/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';

import {chromium, type Browser, type Page} from 'patchright';

import {monitorEvents} from '../../../src/tools/debugger/monitorEvents.js';
import {queryDom} from '../../../src/tools/dom/queryDom.js';
import {click} from '../../../src/tools/input/click.js';
import {waitForElement} from '../../../src/tools/page/waitForElement.js';
import {ErrorCodes, ToolError} from '../../../src/utils/errors.js';

describe('locator layer and element error classification e2e', () => {
  let browser: Browser;
  let page: Page;

  function makeHarness() {
    let structuredContent: Record<string, unknown> | undefined;
    return {
      response: {
        setStructuredContent(content: Record<string, unknown>) {
          structuredContent = content;
        },
        appendResponseLine: () => undefined,
      },
      get content() {
        return structuredContent;
      },
      context: {
        getSelectedPage: () => page,
        getSelectedFrame: () => page.mainFrame(),
      },
    };
  }

  before(async () => {
    browser = await chromium.launch({headless: true});
    page = await browser.newPage();
  });

  after(async () => {
    await browser.close();
  });

  it('successfully clicks with .btn, role=, and text= locators', async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="target" class="btn">Submit</button>
        </body>
      </html>
    `);
    await page.evaluate(() => {
      (window as unknown as {clicked: number}).clicked = 0;
      document.querySelector('#target')?.addEventListener('click', () => {
        (window as unknown as {clicked: number}).clicked += 1;
      });
    });

    const harness = makeHarness();

    // 1. CSS
    await click.handler(
      {params: {selector: '.btn'}} as never,
      harness.response as never,
      harness.context as never,
    );
    let clicked = await page.evaluate(
      () => (window as unknown as {clicked: number}).clicked,
    );
    assert.equal(clicked, 1);

    // 2. role=
    await click.handler(
      {params: {selector: 'role=button[name="Submit"]'}} as never,
      harness.response as never,
      harness.context as never,
    );
    clicked = await page.evaluate(
      () => (window as unknown as {clicked: number}).clicked,
    );
    assert.equal(clicked, 2);

    // 3. text=
    await click.handler(
      {params: {selector: 'text=Submit'}} as never,
      harness.response as never,
      harness.context as never,
    );
    clicked = await page.evaluate(
      () => (window as unknown as {clicked: number}).clicked,
    );
    assert.equal(clicked, 3);
  });

  it('throws ELEMENT_LOCATOR_AMBIGUOUS with retryable=false on multi-match', async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button class="dup">Save</button>
          <button class="dup">Save</button>
        </body>
      </html>
    `);

    const harness = makeHarness();

    await assert.rejects(
      async () => {
        await click.handler(
          {
            params: {selector: 'role=button[name="Save"]', timeoutMs: 500},
          } as never,
          harness.response as never,
          harness.context as never,
        );
      },
      (error: unknown) => {
        assert.equal(error instanceof ToolError, true);
        const toolErr = error as ToolError;
        assert.equal(toolErr.code, ErrorCodes.ELEMENT_LOCATOR_AMBIGUOUS);
        assert.equal(toolErr.retryable, false);
        assert.equal(toolErr.context?.candidatesCount, 2);
        return true;
      },
    );
  });

  it('successfully disambiguates multi-match using >> nth=1', async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="b0">Save</button>
          <button id="b1">Save</button>
        </body>
      </html>
    `);
    await page.evaluate(() => {
      document.querySelector('#b0')?.addEventListener('click', () => {
        (window as unknown as {which: string}).which = 'b0';
      });
      document.querySelector('#b1')?.addEventListener('click', () => {
        (window as unknown as {which: string}).which = 'b1';
      });
    });

    const harness = makeHarness();

    await click.handler(
      {params: {selector: 'role=button[name="Save"] >> nth=1'}} as never,
      harness.response as never,
      harness.context as never,
    );

    const which = await page.evaluate(
      () => (window as unknown as {which: string}).which,
    );
    assert.equal(which, 'b1');
  });

  it('query_dom returns null without auto-waiting or throwing on 0 matches', async () => {
    await page.setContent(`<html><body><p>Hello</p></body></html>`);
    const harness = makeHarness();

    const start = Date.now();
    await queryDom.handler(
      {
        params: {selector: 'role=button[name="NonExistent"]', all: false},
      } as never,
      harness.response as never,
      harness.context as never,
    );
    const elapsed = Date.now() - start;

    assert.equal(harness.content?.success, true);
    assert.equal(harness.content?.data, null);
    assert.equal(
      elapsed < 2000,
      true,
      'query_dom should return fast on 0 matches',
    );
  });

  it('wait_for_element returns TIMEOUT with retryable=true on non-existent element', async () => {
    await page.setContent(`<html><body><p>Empty</p></body></html>`);
    const harness = makeHarness();

    await assert.rejects(
      async () => {
        await waitForElement.handler(
          {params: {selector: '#not-there', timeout: 100}} as never,
          harness.response as never,
          harness.context as never,
        );
      },
      (error: unknown) => {
        assert.equal(error instanceof ToolError, true);
        const toolErr = error as ToolError;
        assert.equal(toolErr.code, ErrorCodes.TIMEOUT);
        assert.equal(toolErr.retryable, true);
        return true;
      },
    );
  });

  it('monitor_events with default window selector continues to work', async () => {
    await page.setContent(
      `<html><body><div id="box">Click me</div></body></html>`,
    );
    const harness = makeHarness();

    await monitorEvents.handler(
      {params: {selector: 'window', events: ['click']}} as never,
      harness.response as never,
      harness.context as never,
    );

    assert.equal(harness.content?.success, true);
  });
});
