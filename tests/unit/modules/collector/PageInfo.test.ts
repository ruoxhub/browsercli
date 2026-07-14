/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  clearCookies,
  clearLocalStorage,
  clearSessionStorage,
  evaluate,
  getAllLinks,
  getCookies,
  getContent,
  getLocalStorage,
  getSessionStorage,
  getTitle,
  getURL,
  injectScript,
  setCookies,
  setLocalStorage,
  setSessionStorage,
  setViewport,
} from '../../../../src/modules/collector/PageInfo.js';

function makePage(overrides: Record<string, unknown> = {}) {
  const page: Record<string, unknown> = {
    url: () => 'https://example.com',
    title: async () => 'Example',
    content: async () => '<html></html>',
    evaluate: async () => ({}),
    screenshot: async () => Buffer.from('img'),
    setViewportSize: async () => undefined,
    context: () => ({
      addCookies: async () => undefined,
      cookies: async () => [{name: 'sid', value: '1'}],
      clearCookies: async () => undefined,
      newCDPSession: async () => ({
        send: async () => ({}),
      }),
    }),
    addInitScript: async () => undefined,
    ...overrides,
  };
  return page;
}

describe('PageInfo', () => {
  it('getURL, getTitle, getContent return page values', async () => {
    const page = makePage();

    assert.strictEqual(await getURL(page as any), 'https://example.com');
    assert.strictEqual(await getTitle(page as any), 'Example');
    assert.strictEqual(await getContent(page as any), '<html></html>');
  });

  it('evaluate forwards code and returns result', async () => {
    let calledCode = '';
    const page = makePage({
      evaluate: async (code: string) => {
        calledCode = code;
        return 42;
      },
    });

    const result = await evaluate<number>(page as any, '1 + 41');

    assert.strictEqual(calledCode, '1 + 41');
    assert.strictEqual(result, 42);
  });

  it('setCookies and getCookies use context', async () => {
    let addedCookies: unknown[] = [];
    const page = makePage({
      context: () => ({
        addCookies: async (cookies: unknown[]) => {
          addedCookies = cookies;
        },
        cookies: async () => [{name: 'sid', value: '1'}],
        clearCookies: async () => undefined,
      }),
    });

    await setCookies(page as any, [{name: 'a', value: 'b'}]);
    assert.strictEqual(addedCookies.length, 1);

    const cookies = await getCookies(page as any);
    assert.strictEqual(cookies.length, 1);
    assert.strictEqual(cookies[0].name, 'sid');

    await clearCookies(page as any); // should not throw
  });

  it('setViewport forwards width and height', async () => {
    let viewport: {width?: number; height?: number} = {};
    const page = makePage({
      setViewportSize: async (size: {width: number; height: number}) => {
        viewport = size;
      },
    });

    await setViewport(page as any, 1024, 768);

    assert.strictEqual(viewport.width, 1024);
    assert.strictEqual(viewport.height, 768);
  });

  it('localStorage operations forward to evaluate', async () => {
    const evalCalls: Array<{fn?: unknown; arg?: unknown}> = [];
    const page = makePage({
      evaluate: async (fn: unknown, arg?: unknown) => {
        evalCalls.push({fn, arg});
        if (typeof fn === 'function') {
          return {key: 'value'};
        }
        return {key: 'value'};
      },
    });

    await setLocalStorage(page as any, 'key', 'value');
    assert.deepStrictEqual(evalCalls[0].arg, {k: 'key', v: 'value'});

    const storage = await getLocalStorage(page as any);
    assert.deepStrictEqual(storage, {key: 'value'});

    await clearLocalStorage(page as any); // should not throw
  });

  it('sessionStorage operations forward to evaluate', async () => {
    const evalCalls: Array<{fn?: unknown; arg?: unknown}> = [];
    const page = makePage({
      evaluate: async (fn: unknown, arg?: unknown) => {
        evalCalls.push({fn, arg});
        return {sk: 'sv'};
      },
    });

    await setSessionStorage(page as any, 'sk', 'sv');
    assert.deepStrictEqual(evalCalls[0].arg, {k: 'sk', v: 'sv'});

    const storage = await getSessionStorage(page as any);
    assert.deepStrictEqual(storage, {sk: 'sv'});

    await clearSessionStorage(page as any); // should not throw
  });

  it('getAllLinks returns links from evaluate', async () => {
    const page = makePage({
      evaluate: async () => [
        {text: 'Home', href: 'https://example.com/'},
        {text: 'About', href: 'https://example.com/about'},
      ],
    });

    const links = await getAllLinks(page as any);

    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].text, 'Home');
    assert.strictEqual(links[1].href, 'https://example.com/about');
  });

  it('injectScript calls evaluate with script content', async () => {
    let calledArg: unknown;
    const page = makePage({
      evaluate: async (_fn: unknown, arg?: unknown) => {
        calledArg = arg;
      },
    });

    await injectScript(page as any, 'console.log(1)');

    assert.strictEqual(calledArg, 'console.log(1)');
  });
});
