/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  click,
  clickAt,
  hover,
  pressKey,
  scroll,
  scrollBy,
  select,
  setFiles,
  type,
  uploadFile,
  waitForSelector,
} from '../../../../src/modules/collector/PageInteraction.js';

function makePage(overrides: Record<string, unknown> = {}) {
  const page: Record<string, unknown> = {
    click: async () => undefined,
    type: async () => undefined,
    selectOption: async () => undefined,
    hover: async () => undefined,
    evaluate: async () => ({}),
    waitForSelector: async () => undefined,
    keyboard: {press: async () => undefined},
    $: async () => null,
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({}),
      }),
    }),
    ...overrides,
  };
  return page;
}

describe('PageInteraction', () => {
  it('click forwards selector and options', async () => {
    let calledSelector = '';
    let calledOptions:
      | {button?: string; clickCount?: number; delay?: number}
      | undefined;
    const page = makePage({
      click: async (
        selector: string,
        opts?: {button?: string; clickCount?: number; delay?: number},
      ) => {
        calledSelector = selector;
        calledOptions = opts;
      },
    });

    await click(page as any, '#btn', {button: 'right', clickCount: 2});

    assert.strictEqual(calledSelector, '#btn');
    assert.strictEqual(calledOptions?.button, 'right');
    assert.strictEqual(calledOptions?.clickCount, 2);
  });

  it('type forwards text and delay', async () => {
    let calledArgs: {selector?: string; text?: string; delay?: number} = {};
    const page = makePage({
      type: async (selector: string, text: string, opts?: {delay?: number}) => {
        calledArgs = {selector, text, delay: opts?.delay};
      },
    });

    await type(page as any, '#input', 'hello', {delay: 50});

    assert.strictEqual(calledArgs.selector, '#input');
    assert.strictEqual(calledArgs.text, 'hello');
    assert.strictEqual(calledArgs.delay, 50);
  });

  it('select forwards values to selectOption', async () => {
    let calledArgs: {selector?: string; values?: string[]} = {};
    const page = makePage({
      selectOption: async (selector: string, values: string[]) => {
        calledArgs = {selector, values};
      },
    });

    await select(page as any, '#sel', 'a', 'b');

    assert.strictEqual(calledArgs.selector, '#sel');
    assert.deepStrictEqual(calledArgs.values, ['a', 'b']);
  });

  it('scroll and scrollBy invoke evaluate', async () => {
    let evalArgs: {fn?: unknown; arg?: unknown} = {};
    const page = makePage({
      evaluate: async (fn: unknown, arg?: unknown) => {
        evalArgs = {fn, arg};
        return 'scrolled down 500px';
      },
    });

    await scroll(page as any, {x: 10, y: 20});
    assert.deepStrictEqual(evalArgs.arg, {x: 10, y: 20});

    await scrollBy(page as any, 'down', 500);
    assert.deepStrictEqual(evalArgs.arg, {dir: 'down', px: 500});
  });

  it('waitForSelector returns success when element appears', async () => {
    const page = makePage({
      waitForSelector: async () => undefined,
      evaluate: async () => ({
        tagName: 'button',
        id: 'submit',
        className: 'primary',
        textContent: 'Submit',
        attributes: {},
      }),
    });

    const result = await waitForSelector(page as any, '#submit', 5000);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.element?.tagName, 'button');
    assert.ok(result.message.includes('#submit'));
  });

  it('waitForSelector returns failure on timeout', async () => {
    const page = makePage({
      waitForSelector: async () => {
        throw new Error('Timeout 1000ms exceeded');
      },
    });

    const result = await waitForSelector(page as any, '#missing', 1000);

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('#missing'));
  });

  it('pressKey forwards to keyboard.press', async () => {
    let pressedKey = '';
    const page = makePage({
      keyboard: {
        press: async (key: string) => {
          pressedKey = key;
        },
      },
    });

    await pressKey(page as any, 'Enter');

    assert.strictEqual(pressedKey, 'Enter');
  });

  it('setFiles uses CDP session', async () => {
    const sentCommands: Array<{method: string; params?: unknown}> = [];
    const page = makePage({
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string, params?: unknown) => {
            sentCommands.push({method, params});
            if (method === 'DOM.getDocument') {
              return {root: {nodeId: 1}};
            }
            if (method === 'DOM.querySelector') {
              return {nodeId: 42};
            }
            return {};
          },
        }),
      }),
    });

    const result = await setFiles(page as any, '#upload', ['/a/b.txt']);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.files, 1);
    assert.ok(sentCommands.some(c => c.method === 'DOM.enable'));
    assert.ok(sentCommands.some(c => c.method === 'DOM.getDocument'));
    assert.ok(sentCommands.some(c => c.method === 'DOM.querySelector'));
    assert.ok(sentCommands.some(c => c.method === 'DOM.setFileInputFiles'));
  });

  it('uploadFile throws when input not found', async () => {
    const page = makePage({
      $: async () => null,
    });

    await assert.rejects(
      () => uploadFile(page as any, '#missing', '/a/b.txt'),
      /File input not found/,
    );
  });

  it('clickAt reads metadata before dispatching the CDP click', async () => {
    const order: string[] = [];
    const cdpSession = {
      send: async (method: string) => {
        order.push(method);
        return {};
      },
      detach: async () => undefined,
    };
    const mockEl = {
      getClientRects: () => [
        {left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50},
      ],
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 50,
        width: 100,
        height: 50,
      }),
      contains: () => false,
    };
    const frame = {
      locator: () => ({
        scrollIntoViewIfNeeded: async () => undefined,
        elementHandle: async () => ({
          evaluate: async (fn: (el: unknown) => unknown) => {
            const globalObj = globalThis as Record<string, unknown>;
            const prevWin = globalObj.window;
            const prevDoc = globalObj.document;
            globalObj.window = {innerWidth: 800, innerHeight: 600};
            globalObj.document = {elementFromPoint: () => mockEl};
            try {
              return fn(mockEl);
            } finally {
              globalObj.window = prevWin;
              globalObj.document = prevDoc;
            }
          },
        }),
        evaluate: async () => {
          order.push('metadata');
          return {tag: 'BUTTON', text: '提交'};
        },
      }),
    };
    const page = makePage({
      mainFrame: () => frame,
      context: () => ({newCDPSession: async () => cdpSession}),
    });

    const result = await clickAt(page as never, 'role=button');

    assert.strictEqual(result.x, 50);
    assert.strictEqual(result.y, 25);
    assert.strictEqual(result.tag, 'BUTTON');
    assert.strictEqual(result.text, '提交');
    // 元数据读取必须早于鼠标事件，否则点击触发导航后取值会失败
    assert.ok(
      order.indexOf('metadata') < order.indexOf('Input.dispatchMouseEvent'),
    );
    // 不依赖 CSS：非 CSS 定位器不应回退到 document.querySelector
    assert.strictEqual(order.filter(item => item === 'metadata').length, 1);
  });

  it('hover forwards selector', async () => {
    let hovered = '';
    const page = makePage({
      hover: async (selector: string) => {
        hovered = selector;
      },
    });

    await hover(page as any, '#menu');

    assert.strictEqual(hovered, '#menu');
  });
});
